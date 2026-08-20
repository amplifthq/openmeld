import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createRuntimeReportingApi,
  type OpenMeldApiClientFoundation,
} from "@openmeld/api-client";
import { AGENT_ACTIVITY_SESSION_RECONCILIATION_PAGE_MAX } from "@openmeld/schemas";
import type {
  LocalAgentSessionProvider,
  ObservedLocalAgentSession,
  SubmitAgentActivitySessionReconciliationBody,
} from "@openmeld/schemas/types";
import { getAuthSessionState } from "../config/auth-session";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import { OPENMELD_HOME_ENV_KEY, resolveOpenMeldRootDir } from "../config/paths";
import { canAttachAuthTokenToRequest } from "../config/request-headers";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { listProjectBindings, type ProjectBinding } from "./project-bindings";
import {
  discoverLocalAgentSessionProviders,
  type LocalAgentSessionProviderDiscovery,
} from "./session-inventory-provider-adapters";

const SOURCE_STORE_VERSION = 2 as const;

type StoredInventorySource = {
  agentControllerRef: string;
  localConnectionId: string;
  organizationId: string;
  ownerUserId: string;
  projectId: string;
  provider: LocalAgentSessionProvider;
  repositoryFingerprint: string | null;
};

type InventorySourceStore = {
  sources: StoredInventorySource[];
  version: typeof SOURCE_STORE_VERSION;
};

type CurrentInventorySource = StoredInventorySource & {
  problemCode?: string;
  result: "error" | "sessions" | "unsupported";
  sessions: ObservedLocalAgentSession[];
};

export type LocalAgentSessionInventorySyncResult = {
  reason: string | null;
  sessionCount: number;
  sourceCount: number;
  status: "idle" | "submitted" | "unavailable";
  submittedSourceCount: number;
};

type InventorySourceSubmissionResult = {
  firstFailure: unknown;
  hasFailure: boolean;
  sessionCount: number;
  submittedSourceCount: number;
};

export async function syncLocalAgentSessionInventory(
  input: {
    foundation?: OpenMeldApiClientFoundation;
    homeDir?: string;
    nowMs?: number;
    rootDir?: string;
  } = {}
): Promise<LocalAgentSessionInventorySyncResult> {
  const storedBindings = await listProjectBindings({ rootDir: input.rootDir });
  const sourceStore = await readSourceStore(input);
  if (storedBindings.length === 0 && sourceStore.sources.length === 0) {
    return emptySyncResult("idle", null);
  }
  const reporting = await prepareReporting(input);
  if (!reporting.ok) {
    return emptySyncResult("unavailable", reporting.reason);
  }
  const bindings = bindingsOwnedByCurrentUser({
    bindings: storedBindings,
    ownerUserId: reporting.ownerUserId,
    sources: sourceStore.sources,
  });
  const previousSources = sourceStore.sources.filter(
    (source) => source.ownerUserId === reporting.ownerUserId
  );
  if (bindings.length === 0 && previousSources.length === 0) {
    return emptySyncResult("idle", null);
  }
  const nowMs = input.nowMs ?? Date.now();
  const discoveries =
    bindings.length === 0
      ? []
      : await discoverLocalAgentSessionProviders({
          bindings,
          homeDir: input.homeDir,
          nowMs,
          rootDir: input.rootDir,
        });
  const currentSources = buildCurrentSources({
    bindings,
    discoveries,
    ownerUserId: reporting.ownerUserId,
  });
  const currentKeys = new Set(currentSources.map(sourceKey));
  const disconnectedSources = previousSources.filter(
    (source) => !currentKeys.has(sourceKey(source))
  );
  const api = createRuntimeReportingApi(reporting.foundation);
  const registration = await api.submitRegistration({
    deviceId: reporting.deviceId,
    lane: reporting.lane,
  });
  if (
    registration.status === "rejected" ||
    !registration.openMeldServiceRuntimeId
  ) {
    return emptySyncResult("unavailable", "registration_rejected");
  }
  const retainedSources = new Map(
    sourceStore.sources.map((source) => [sourceKey(source), source])
  );
  const common = {
    api,
    deviceId: reporting.deviceId,
    lane: reporting.lane,
    nowMs,
    openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
    retainedSources,
  };
  const disconnected = await submitDisconnectedSources({
    ...common,
    sources: disconnectedSources,
  });
  const current = await submitCurrentSources({
    ...common,
    sourceStoreInput: input,
    sources: currentSources,
  });
  const hasSourceFailure = disconnected.hasFailure || current.hasFailure;
  const firstSourceFailure = disconnected.hasFailure
    ? disconnected.firstFailure
    : current.firstFailure;
  const sessionCount = current.sessionCount;
  const submittedSourceCount =
    disconnected.submittedSourceCount + current.submittedSourceCount;
  await writeSourceStore(input, {
    sources: [...retainedSources.values()],
    version: SOURCE_STORE_VERSION,
  });
  return {
    reason: hasSourceFailure
      ? classifyInventorySyncFailure(firstSourceFailure)
      : null,
    sessionCount,
    sourceCount: currentSources.length + disconnectedSources.length,
    status: resolveInventorySyncStatus({
      hasSourceFailure,
      submittedSourceCount,
    }),
    submittedSourceCount,
  };
}

class InventorySourceStoreWriteError extends Error {
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super("Failed to persist the Session Inventory source store.");
    this.name = "InventorySourceStoreWriteError";
    this.originalError = originalError;
  }
}

async function submitDisconnectedSources(input: {
  api: ReturnType<typeof createRuntimeReportingApi>;
  deviceId: string;
  lane: string;
  nowMs: number;
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority";
    value: string;
  };
  retainedSources: Map<string, StoredInventorySource>;
  sources: readonly StoredInventorySource[];
}): Promise<InventorySourceSubmissionResult> {
  const result = emptySourceSubmissionResult();
  for (const source of input.sources) {
    try {
      await submitDisconnectedSource({ ...input, source });
      input.retainedSources.delete(sourceKey(source));
      result.submittedSourceCount += 1;
    } catch (error) {
      recordFirstSourceFailure(result, error);
    }
  }
  return result;
}

async function submitCurrentSources(input: {
  api: ReturnType<typeof createRuntimeReportingApi>;
  deviceId: string;
  lane: string;
  nowMs: number;
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority";
    value: string;
  };
  retainedSources: Map<string, StoredInventorySource>;
  sources: readonly CurrentInventorySource[];
  sourceStoreInput: { rootDir?: string };
}): Promise<InventorySourceSubmissionResult> {
  const result = emptySourceSubmissionResult();
  for (const source of input.sources) {
    const key = sourceKey(source);
    let sourceStored = input.retainedSources.has(key);
    try {
      await submitCurrentSource({
        ...input,
        onPageAccepted: async () => {
          if (sourceStored) {
            return;
          }
          input.retainedSources.set(key, storedSource(source));
          try {
            await writeSourceStore(input.sourceStoreInput, {
              sources: [...input.retainedSources.values()],
              version: SOURCE_STORE_VERSION,
            });
          } catch (error) {
            throw new InventorySourceStoreWriteError(error);
          }
          sourceStored = true;
        },
        source,
      });
      input.retainedSources.set(key, storedSource(source));
      result.sessionCount += source.sessions.length;
      result.submittedSourceCount += 1;
    } catch (error) {
      if (error instanceof InventorySourceStoreWriteError) {
        throw error.originalError;
      }
      recordFirstSourceFailure(result, error);
    }
  }
  return result;
}

function emptySourceSubmissionResult(): InventorySourceSubmissionResult {
  return {
    firstFailure: undefined,
    hasFailure: false,
    sessionCount: 0,
    submittedSourceCount: 0,
  };
}

function recordFirstSourceFailure(
  result: InventorySourceSubmissionResult,
  error: unknown
): void {
  if (result.hasFailure) {
    return;
  }
  result.firstFailure = error;
  result.hasFailure = true;
}

function resolveInventorySyncStatus(input: {
  hasSourceFailure: boolean;
  submittedSourceCount: number;
}): LocalAgentSessionInventorySyncResult["status"] {
  if (input.hasSourceFailure) {
    return "unavailable";
  }
  return input.submittedSourceCount > 0 ? "submitted" : "idle";
}

function bindingsOwnedByCurrentUser(input: {
  bindings: readonly ProjectBinding[];
  ownerUserId: string;
  sources: readonly StoredInventorySource[];
}): ProjectBinding[] {
  const ownersByConnection = new Map<string, Set<string>>();
  for (const source of input.sources) {
    const owners =
      ownersByConnection.get(source.localConnectionId) ?? new Set();
    owners.add(source.ownerUserId);
    ownersByConnection.set(source.localConnectionId, owners);
  }
  return input.bindings.filter((binding) => {
    const knownOwners = ownersByConnection.get(buildLocalConnectionId(binding));
    return (
      knownOwners === undefined ||
      (knownOwners.size === 1 && knownOwners.has(input.ownerUserId))
    );
  });
}

function buildCurrentSources(input: {
  bindings: readonly ProjectBinding[];
  discoveries: readonly LocalAgentSessionProviderDiscovery[];
  ownerUserId: string;
}): CurrentInventorySource[] {
  const sources: CurrentInventorySource[] = [];
  for (const binding of input.bindings) {
    for (const discovery of input.discoveries) {
      const common = sourceFromBinding(binding, discovery, input.ownerUserId);
      if (discovery.result !== "sessions") {
        sources.push({
          ...common,
          problemCode: discovery.problemCode,
          result: discovery.result,
          sessions: [],
        });
        continue;
      }
      sources.push({
        ...common,
        result: "sessions",
        sessions: discovery.sessions
          .filter(
            (candidate) =>
              candidate.binding.bindingGeneration === binding.bindingGeneration
          )
          .map((candidate) => candidate.session),
      });
    }
  }
  return sources.sort((left, right) =>
    sourceKey(left).localeCompare(sourceKey(right))
  );
}

function sourceFromBinding(
  binding: ProjectBinding,
  discovery: LocalAgentSessionProviderDiscovery,
  ownerUserId: string
): StoredInventorySource {
  return {
    agentControllerRef: discovery.agentControllerRef,
    localConnectionId: buildLocalConnectionId(binding),
    organizationId: binding.organizationId,
    ownerUserId,
    projectId: binding.projectId,
    provider: discovery.provider,
    repositoryFingerprint: binding.repositoryFingerprint,
  };
}

async function submitCurrentSource(input: {
  api: ReturnType<typeof createRuntimeReportingApi>;
  deviceId: string;
  lane: string;
  nowMs: number;
  onPageAccepted: () => Promise<void>;
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority";
    value: string;
  };
  source: CurrentInventorySource;
}): Promise<void> {
  const reconciliationId = randomUUID();
  if (input.source.result !== "sessions") {
    await input.api.submitAgentActivitySessionReconciliation({
      ...submissionCommon(input),
      pageIndex: 0,
      problemCode: input.source.problemCode,
      reconciliationId,
      result: input.source.result,
      sessions: [],
      terminal: true,
    });
    await input.onPageAccepted();
    return;
  }
  const pages = pageSessions(input.source.sessions);
  for (const [pageIndex, sessions] of pages.entries()) {
    await input.api.submitAgentActivitySessionReconciliation({
      ...submissionCommon(input),
      pageIndex,
      reconciliationId,
      result: "sessions",
      sessions,
      terminal: pageIndex === pages.length - 1,
    });
    await input.onPageAccepted();
  }
}

async function submitDisconnectedSource(input: {
  api: ReturnType<typeof createRuntimeReportingApi>;
  deviceId: string;
  lane: string;
  nowMs: number;
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority";
    value: string;
  };
  source: StoredInventorySource;
}): Promise<void> {
  await input.api.submitAgentActivitySessionReconciliation({
    ...submissionCommon(input),
    pageIndex: 0,
    reconciliationId: randomUUID(),
    result: "disconnected",
    sessions: [],
    terminal: true,
  });
}

function submissionCommon(input: {
  deviceId: string;
  lane: string;
  nowMs: number;
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority";
    value: string;
  };
  source: StoredInventorySource;
}): Pick<
  SubmitAgentActivitySessionReconciliationBody,
  | "agentControllerRef"
  | "lane"
  | "localConnectionId"
  | "observedAtMs"
  | "openMeldServiceRuntimeId"
  | "organizationId"
  | "projectId"
  | "provider"
  | "repositoryFingerprint"
> & { deviceId: string } {
  return {
    agentControllerRef: input.source.agentControllerRef,
    deviceId: input.deviceId,
    lane: input.lane,
    localConnectionId: input.source.localConnectionId,
    observedAtMs: input.nowMs,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    organizationId: input.source.organizationId,
    projectId: input.source.projectId,
    provider: input.source.provider,
    repositoryFingerprint: input.source.repositoryFingerprint,
  };
}

function pageSessions(
  sessions: readonly ObservedLocalAgentSession[]
): ObservedLocalAgentSession[][] {
  const stable = [...sessions].sort((left, right) =>
    left.nativeSessionId.localeCompare(right.nativeSessionId)
  );
  if (stable.length === 0) {
    return [[]];
  }
  const pages: ObservedLocalAgentSession[][] = [];
  for (
    let index = 0;
    index < stable.length;
    index += AGENT_ACTIVITY_SESSION_RECONCILIATION_PAGE_MAX
  ) {
    pages.push(
      stable.slice(
        index,
        index + AGENT_ACTIVITY_SESSION_RECONCILIATION_PAGE_MAX
      )
    );
  }
  return pages;
}

async function prepareReporting(input: {
  foundation?: OpenMeldApiClientFoundation;
  rootDir?: string;
}): Promise<
  | {
      deviceId: string;
      foundation: OpenMeldApiClientFoundation;
      lane: string;
      ok: true;
      ownerUserId: string;
    }
  | { ok: false; reason: string }
> {
  const serviceContract = await readDaemonServiceContract({
    env: input.rootDir
      ? { ...process.env, [OPENMELD_HOME_ENV_KEY]: input.rootDir }
      : process.env,
  }).catch(() => null);
  if (
    !(
      serviceContract?.deviceId &&
      serviceContract.gatewayUrl &&
      serviceContract.lane
    )
  ) {
    return { ok: false, reason: "service_contract_unavailable" };
  }
  const auth = await getAuthSessionState({ validateRemote: false }).catch(
    () => null
  );
  const ownerUserId = auth?.session?.user?.id?.trim() ?? "";
  if (!(auth?.state === "valid" && auth.session && ownerUserId)) {
    return { ok: false, reason: "auth_unavailable" };
  }
  if (
    !(
      input.foundation ||
      canAttachAuthTokenToRequest(auth.session, serviceContract.gatewayUrl)
    )
  ) {
    return { ok: false, reason: "auth_unavailable" };
  }
  return {
    deviceId: serviceContract.deviceId,
    foundation:
      input.foundation ??
      createCliApiClientFoundation(serviceContract.gatewayUrl),
    lane: serviceContract.lane,
    ok: true,
    ownerUserId,
  };
}

function buildLocalConnectionId(binding: ProjectBinding): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify([
        binding.organizationId,
        binding.projectId,
        binding.bindingGeneration,
      ])
    )
    .digest("hex")}`;
}

function sourceKey(source: StoredInventorySource): string {
  return [
    source.ownerUserId,
    source.organizationId,
    source.projectId,
    source.localConnectionId,
    source.agentControllerRef,
  ].join("\0");
}

function storedSource(source: StoredInventorySource): StoredInventorySource {
  return {
    agentControllerRef: source.agentControllerRef,
    localConnectionId: source.localConnectionId,
    organizationId: source.organizationId,
    ownerUserId: source.ownerUserId,
    projectId: source.projectId,
    provider: source.provider,
    repositoryFingerprint: source.repositoryFingerprint,
  };
}

async function readSourceStore(input: {
  rootDir?: string;
}): Promise<InventorySourceStore> {
  const path = sourceStorePath(input);
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw new Error(
      `Failed to read the Session Inventory source store: ${path}`,
      {
        cause: error,
      }
    );
  });
  if (raw === null) {
    return { sources: [], version: SOURCE_STORE_VERSION };
  }
  const value: unknown = JSON.parse(raw);
  if (isLegacySourceStore(value)) {
    return { sources: [], version: SOURCE_STORE_VERSION };
  }
  if (
    !(
      value &&
      typeof value === "object" &&
      "version" in value &&
      value.version === SOURCE_STORE_VERSION &&
      "sources" in value &&
      Array.isArray(value.sources) &&
      value.sources.every(isStoredInventorySource)
    )
  ) {
    throw new Error(`Session Inventory source store is invalid: ${path}`);
  }
  return value as InventorySourceStore;
}

function isLegacySourceStore(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "version" in value &&
      value.version === 1 &&
      "sources" in value &&
      Array.isArray(value.sources)
  );
}

function isStoredInventorySource(
  value: unknown
): value is StoredInventorySource {
  return Boolean(
    value &&
      typeof value === "object" &&
      "agentControllerRef" in value &&
      typeof value.agentControllerRef === "string" &&
      "localConnectionId" in value &&
      typeof value.localConnectionId === "string" &&
      "organizationId" in value &&
      typeof value.organizationId === "string" &&
      "ownerUserId" in value &&
      typeof value.ownerUserId === "string" &&
      "projectId" in value &&
      typeof value.projectId === "string" &&
      "provider" in value &&
      typeof value.provider === "string" &&
      "repositoryFingerprint" in value &&
      (value.repositoryFingerprint === null ||
        typeof value.repositoryFingerprint === "string")
  );
}

async function writeSourceStore(
  input: { rootDir?: string },
  store: InventorySourceStore
): Promise<void> {
  const path = sourceStorePath(input);
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(store)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

function sourceStorePath(input: { rootDir?: string }): string {
  return join(
    input.rootDir ?? resolveOpenMeldRootDir(),
    "device",
    "agent-activity",
    "session-inventory-sources.json"
  );
}

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === code
  );
}

function classifyInventorySyncFailure(error: unknown): string {
  if (error && typeof error === "object") {
    const status = "status" in error ? Number(error.status) : Number.NaN;
    if (status === 401 || status === 403) {
      return "inventory_write_auth_rejected";
    }
    if (status === 404) {
      return "inventory_endpoint_unavailable";
    }
    if (status === 408 || status === 429 || status >= 500) {
      return "inventory_write_retryable_http_failure";
    }
  }
  return "inventory_write_transport_failure";
}

function emptySyncResult(
  status: LocalAgentSessionInventorySyncResult["status"],
  reason: string | null
): LocalAgentSessionInventorySyncResult {
  return {
    reason,
    sessionCount: 0,
    sourceCount: 0,
    status,
    submittedSourceCount: 0,
  };
}
