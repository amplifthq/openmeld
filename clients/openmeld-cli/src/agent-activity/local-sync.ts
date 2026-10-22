import {
  createAgentActivityApi,
  createRuntimeReportingApi,
} from "@openmeld/api-client";
import { getAuthSessionState } from "../config/auth-session";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import { canAttachAuthTokenToRequest } from "../config/request-headers";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import {
  applyControllerTaskLifecycleSubmissionResults,
  deferControllerTaskLifecycleOutbox,
  readControllerTaskLifecycleOutboxHealth,
  readDueControllerTaskLifecycleOutbox,
  removeUnboundControllerTaskLifecycleEvents,
} from "./controller-task-lifecycle-store";
import { drainAgentActivityHookInbox, removeProjectInbox } from "./hook-inbox";
import {
  removeAgentActivityContextCache,
  removeAllAgentActivityContextCaches,
  writeAgentActivityContextCache,
} from "./local-context-cache";
import {
  AgentActivitySubmissionResultsMismatchError,
  applyAgentActivitySubmissionResults,
  deferAgentActivityOutbox,
  readAgentActivityOutboxHealth,
  readDueAgentActivityOutbox,
  removeProjectOutbox,
} from "./local-event-store";
import {
  scanLocalAgentActivity,
  startAgentActivityTranscriptWatchers,
} from "./local-observer";
import { withAgentActivityDeliveryLock } from "./local-state-lock";
import {
  isProjectConnectionUsableByOwner,
  listProjectBindings,
  removeAgentActivityBindingsWhileDeliveryLocked,
} from "./project-bindings";
import {
  type LocalAgentSessionInventorySyncResult,
  syncLocalAgentSessionInventory,
} from "./session-inventory-sync";

export type AgentActivityLocalSyncResult = {
  controllerTaskEventSubmittedCount: number;
  controllerTaskHealth: Awaited<
    ReturnType<typeof readControllerTaskLifecycleOutboxHealth>
  >;
  health: Awaited<ReturnType<typeof readAgentActivityOutboxHealth>>;
  observedCount: number;
  reason: string | null;
  sessionInventory: LocalAgentSessionInventorySyncResult;
  status: "idle" | "submitted" | "unavailable";
  submittedCount: number;
};

export type LocalAgentActivitySyncLoop = {
  requestSync: (input?: {
    reconcile?: boolean;
    refreshContext?: boolean;
  }) => void;
  stop: () => Promise<void>;
};

export async function syncLocalAgentActivity(input?: {
  reconcile?: boolean;
  refreshContext?: boolean;
  rootDir?: string;
}): Promise<AgentActivityLocalSyncResult> {
  const inbox = await drainAgentActivityHookInbox({ rootDir: input?.rootDir });
  const reconciliation =
    input?.reconcile === false
      ? { observedCount: 0 }
      : await scanLocalAgentActivity({
          drainInbox: false,
          rootDir: input?.rootDir,
        });
  const observedCount = inbox.observedCount + reconciliation.observedCount;
  const [result, sessionInventory] = await withAgentActivityDeliveryLock(
    { rootDir: input?.rootDir },
    async () => {
      const [activityResult, inventoryResult] = await Promise.allSettled([
        submitDueAgentActivity(input, observedCount),
        input?.reconcile === false
          ? Promise.resolve(idleSessionInventoryResult())
          : syncLocalAgentSessionInventory({ rootDir: input?.rootDir }),
      ]);
      if (activityResult.status === "rejected") {
        throw activityResult.reason;
      }
      if (inventoryResult.status === "rejected") {
        throw inventoryResult.reason;
      }
      return [activityResult.value, inventoryResult.value] as const;
    }
  );
  if (input?.refreshContext !== false) {
    await refreshAgentActivityContextCaches({ rootDir: input?.rootDir }).catch(
      () => undefined
    );
  }
  return {
    ...result,
    reason:
      result.reason ??
      (sessionInventory.status === "unavailable"
        ? sessionInventory.reason
        : null),
    sessionInventory,
    status: resolveCombinedAgentActivitySyncStatus({
      activityStatus: result.status,
      sessionInventoryStatus: sessionInventory.status,
    }),
  };
}

export function resolveCombinedAgentActivitySyncStatus(input: {
  activityStatus: AgentActivityLocalSyncResult["status"];
  sessionInventoryStatus: LocalAgentSessionInventorySyncResult["status"];
}): AgentActivityLocalSyncResult["status"] {
  if (
    input.activityStatus === "unavailable" ||
    input.sessionInventoryStatus === "unavailable"
  ) {
    return "unavailable";
  }
  if (
    input.activityStatus === "submitted" ||
    input.sessionInventoryStatus === "submitted"
  ) {
    return "submitted";
  }
  return "idle";
}

async function submitDueAgentActivity(
  input: { rootDir?: string } | undefined,
  observedCount: number
): Promise<AgentActivityLocalSyncResult> {
  const dueRecords = await readDueAgentActivityOutbox({
    rootDir: input?.rootDir,
  });
  const dueControllerTaskEvents = await readDueControllerTaskLifecycleOutbox({
    rootDir: input?.rootDir,
  });
  const bindings = await listProjectBindings({
    rootDir: input?.rootDir,
  });
  const boundOrganizationIds = new Set(
    bindings.map((binding) => binding.organizationId)
  );
  await removeUnboundControllerTaskLifecycleEvents({
    organizationIds: boundOrganizationIds,
    rootDir: input?.rootDir,
  });
  const controllerTaskEvents = dueControllerTaskEvents.filter((record) =>
    boundOrganizationIds.has(record.event.organizationId)
  );
  const boundProjects = new Set(
    bindings.map(
      (binding) => `${binding.organizationId}\u0000${binding.projectId}`
    )
  );
  const records = dueRecords.filter((record) =>
    boundProjects.has(
      `${record.event.organizationId}\u0000${record.event.projectId}`
    )
  );
  for (const record of dueRecords) {
    if (!records.includes(record)) {
      await removeProjectOutbox({
        organizationId: record.event.organizationId,
        projectId: record.event.projectId,
        rootDir: input?.rootDir,
      });
    }
  }
  if (records.length === 0 && controllerTaskEvents.length === 0) {
    const [health, controllerTaskHealth] = await readLocalReportingHealth(
      input?.rootDir
    );
    return {
      controllerTaskEventSubmittedCount: 0,
      controllerTaskHealth,
      health,
      observedCount,
      reason: null,
      sessionInventory: idleSessionInventoryResult(),
      status: "idle",
      submittedCount: 0,
    };
  }
  const serviceContract = await readDaemonServiceContract().catch(() => null);
  if (
    !(
      serviceContract?.deviceId &&
      serviceContract.gatewayUrl &&
      serviceContract.lane
    )
  ) {
    await deferLocalReportingOutboxes({
      activityRecords: records,
      controllerTaskEvents,
      rootDir: input?.rootDir,
    });
    return unavailable(input, observedCount, "service_contract_unavailable");
  }
  const auth = await getAuthSessionState().catch(() => null);
  if (
    !(
      auth?.state === "valid" &&
      auth.session &&
      auth.session.user?.id &&
      canAttachAuthTokenToRequest(auth.session, serviceContract.gatewayUrl)
    )
  ) {
    await deferLocalReportingOutboxes({
      activityRecords: records,
      controllerTaskEvents,
      rootDir: input?.rootDir,
    });
    return unavailable(input, observedCount, "auth_unavailable");
  }
  const ownerUserId = auth.session.user.id;
  const ownerProjectKeys = new Set(
    bindings
      .filter((binding) =>
        isProjectConnectionUsableByOwner(binding, ownerUserId)
      )
      .map((binding) => `${binding.organizationId}\u0000${binding.projectId}`)
  );
  const sendRecords = records.filter((record) =>
    ownerProjectKeys.has(
      `${record.event.organizationId}\u0000${record.event.projectId}`
    )
  );
  const withheldRecords = records.filter(
    (record) => !sendRecords.includes(record)
  );
  if (withheldRecords.length > 0) {
    await deferAgentActivityOutbox({
      records: withheldRecords,
      rootDir: input?.rootDir,
    });
  }
  try {
    const foundation = createCliApiClientFoundation(serviceContract.gatewayUrl);
    const api = createRuntimeReportingApi(foundation);
    const registration = await api.submitRegistration({
      deviceId: serviceContract.deviceId,
      lane: serviceContract.lane,
    });
    if (
      !(
        registration.status !== "rejected" &&
        registration.openMeldServiceRuntimeId
      )
    ) {
      await deferLocalReportingOutboxes({
        activityRecords: sendRecords,
        controllerTaskEvents,
        rootDir: input?.rootDir,
      });
      return unavailable(input, observedCount, "registration_rejected");
    }
    let controllerTaskEventSubmittedCount = 0;
    if (controllerTaskEvents.length > 0) {
      const lifecycleResponse =
        await api.submitAgentControllerTaskLifecycleEvents({
          deviceId: serviceContract.deviceId,
          events: controllerTaskEvents.map((record) => record.event),
          lane: serviceContract.lane,
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        });
      await applyControllerTaskLifecycleSubmissionResults({
        records: controllerTaskEvents,
        results: lifecycleResponse.events,
        rootDir: input?.rootDir,
      });
      controllerTaskEventSubmittedCount = lifecycleResponse.events.filter(
        (event) => event.status === "accepted"
      ).length;
    }
    const response =
      sendRecords.length === 0
        ? null
        : await api.submitAgentActivityEvents({
            deviceId: serviceContract.deviceId,
            events: sendRecords.map((record) => record.event),
            lane: serviceContract.lane,
            openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
          });
    if (response) {
      await applyAgentActivitySubmissionResults({
        records: sendRecords,
        results: response.events,
        rootDir: input?.rootDir,
      });
      await disableRejectedAgentActivityBindings({
        records: sendRecords,
        results: response.events,
        rootDir: input?.rootDir,
      });
    }
    const [health, controllerTaskHealth] = await readLocalReportingHealth(
      input?.rootDir
    );
    return {
      controllerTaskEventSubmittedCount,
      controllerTaskHealth,
      health,
      observedCount,
      reason: withheldRecords.length > 0 ? "binding_owner_mismatch" : null,
      sessionInventory: idleSessionInventoryResult(),
      status: withheldRecords.length > 0 ? "unavailable" : "submitted",
      submittedCount:
        response?.events.filter(
          (event) => event.outcome === "accepted" || event.outcome === "reused"
        ).length ?? 0,
    };
  } catch (error) {
    await deferLocalReportingOutboxes({
      activityRecords: sendRecords,
      controllerTaskEvents,
      rootDir: input?.rootDir,
    });
    return unavailable(input, observedCount, classifySyncFailure(error));
  }
}

async function deferLocalReportingOutboxes(input: {
  activityRecords: Parameters<typeof deferAgentActivityOutbox>[0]["records"];
  controllerTaskEvents: Parameters<
    typeof deferControllerTaskLifecycleOutbox
  >[0]["records"];
  rootDir?: string;
}): Promise<void> {
  await Promise.all([
    deferAgentActivityOutbox({
      records: input.activityRecords,
      rootDir: input.rootDir,
    }),
    deferControllerTaskLifecycleOutbox({
      records: input.controllerTaskEvents,
      rootDir: input.rootDir,
    }),
  ]);
}

async function refreshAgentActivityContextCaches(input: {
  foundation?: ReturnType<typeof createCliApiClientFoundation>;
  rootDir?: string;
}) {
  const allBindings = await listProjectBindings({
    rootDir: input.rootDir,
  });
  if (allBindings.length === 0) {
    await removeAllAgentActivityContextCaches({ rootDir: input.rootDir });
    return;
  }
  let foundation = input.foundation;
  if (!foundation) {
    const serviceContract = await readDaemonServiceContract().catch(() => null);
    if (
      !(
        serviceContract?.gatewayUrl &&
        serviceContract.deviceId &&
        serviceContract.lane
      )
    ) {
      return;
    }
    const auth = await getAuthSessionState().catch(() => null);
    if (
      !(
        auth?.state === "valid" &&
        auth.session &&
        canAttachAuthTokenToRequest(auth.session, serviceContract.gatewayUrl)
      )
    ) {
      return;
    }
    foundation = createCliApiClientFoundation(serviceContract.gatewayUrl);
  }
  const snapshot = await createAgentActivityApi(foundation).readSnapshot();
  let bindings = await listProjectBindings({
    organizationId: snapshot.organizationId,
    rootDir: input.rootDir,
  });
  const activeProjectIds = new Set(
    snapshot.projects
      .filter((project) => project.archivedAtMs === null)
      .map((project) => project.id)
  );
  for (const binding of bindings) {
    if (!activeProjectIds.has(binding.projectId)) {
      await disableAndPurgeAgentActivityBindings({
        organizationId: binding.organizationId,
        projectId: binding.projectId,
        rootDir: input.rootDir,
      });
    }
  }
  bindings = await listProjectBindings({
    organizationId: snapshot.organizationId,
    rootDir: input.rootDir,
  });
  const projectBindings = selectOneBindingPerProjectScope(bindings);
  await Promise.all(
    projectBindings.map(async (binding) => {
      await writeAgentActivityContextCache({
        projectId: binding.projectId,
        rootDir: input.rootDir,
        snapshot,
      });
    })
  );
}

export function selectOneBindingPerProjectScope<
  T extends {
    isDefault: boolean;
    organizationId: string;
    projectId: string;
  },
>(bindings: readonly T[]): T[] {
  const projectBindings = new Map<string, T>();
  for (const binding of bindings) {
    const key = `${binding.organizationId}\0${binding.projectId}`;
    const current = projectBindings.get(key);
    if (!current || binding.isDefault) {
      projectBindings.set(key, binding);
    }
  }
  return [...projectBindings.values()];
}

async function disableAndPurgeAgentActivityBindings(input: {
  organizationId: string;
  projectId?: string;
  rootDir?: string;
}) {
  await withAgentActivityDeliveryLock(input, async () => {
    const removed = await removeAgentActivityBindingsWhileDeliveryLocked(input);
    await purgeDisabledAgentActivityBindings(removed, input.rootDir);
  });
}

async function disableRejectedAgentActivityBindings(input: {
  records: readonly Awaited<
    ReturnType<typeof readDueAgentActivityOutbox>
  >[number][];
  results: readonly {
    index: number;
    outcome: string;
    reason?: string;
  }[];
  rootDir?: string;
}) {
  const projectScopes = new Map<
    string,
    { organizationId: string; projectId?: string }
  >();
  for (const result of input.results) {
    if (result.outcome !== "permanent_rejected") {
      continue;
    }
    const record = input.records[result.index];
    if (!record) {
      continue;
    }
    if (result.reason === "membership_removed") {
      projectScopes.set(record.event.organizationId, {
        organizationId: record.event.organizationId,
      });
    } else if (
      result.reason === "project_archived" ||
      result.reason === "project_missing" ||
      result.reason === "repository_fingerprint_mismatch"
    ) {
      projectScopes.set(
        `${record.event.organizationId}\u0000${record.event.projectId}`,
        {
          organizationId: record.event.organizationId,
          projectId: record.event.projectId,
        }
      );
    }
  }
  for (const scope of projectScopes.values()) {
    const removed = await removeAgentActivityBindingsWhileDeliveryLocked({
      ...scope,
      rootDir: input.rootDir,
    });
    await purgeDisabledAgentActivityBindings(removed, input.rootDir);
  }
}

async function purgeDisabledAgentActivityBindings(
  bindings: readonly {
    organizationId: string;
    projectId: string;
  }[],
  rootDir?: string
) {
  const projectScopes = new Map(
    bindings.map((binding) => [
      `${binding.organizationId}\0${binding.projectId}`,
      binding,
    ])
  );
  for (const binding of projectScopes.values()) {
    await Promise.all([
      removeProjectInbox({
        organizationId: binding.organizationId,
        projectId: binding.projectId,
        rootDir,
      }),
      removeProjectOutbox({
        organizationId: binding.organizationId,
        projectId: binding.projectId,
        rootDir,
      }),
      removeAgentActivityContextCache({
        organizationId: binding.organizationId,
        projectId: binding.projectId,
        rootDir,
      }),
    ]);
  }
}

function classifySyncFailure(error: unknown): string {
  if (error instanceof AgentActivitySubmissionResultsMismatchError) {
    return "write_response_invalid";
  }
  if (error && typeof error === "object") {
    const status = "status" in error ? Number(error.status) : Number.NaN;
    if (status === 401 || status === 403) {
      return "write_auth_rejected";
    }
    if (status === 404) {
      return "write_endpoint_unavailable";
    }
    if (status === 408 || status === 429 || status >= 500) {
      return "write_retryable_http_failure";
    }
    if ("name" in error && String(error.name) === "AbortError") {
      return "write_timeout";
    }
  }
  return "write_transport_failure";
}

export function startLocalAgentActivitySyncLoop(input: {
  intervalMs?: number;
  onError?: (error: unknown) => void;
  onResult?: (result: AgentActivityLocalSyncResult) => void;
}): LocalAgentActivitySyncLoop {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let nextContextRefreshAtMs = 0;
  let nextReconciliationAtMs = 0;
  let pendingContextRefresh = false;
  let pendingReconciliation = false;
  const stopWatchers = startAgentActivityTranscriptWatchers({
    onError: input.onError,
  });
  const run = () => {
    if (stopped || inFlight) {
      return;
    }
    const nowMs = Date.now();
    const refreshContext =
      pendingContextRefresh || nowMs >= nextContextRefreshAtMs;
    const reconcile = pendingReconciliation || nowMs >= nextReconciliationAtMs;
    pendingContextRefresh = false;
    pendingReconciliation = false;
    if (refreshContext) {
      nextContextRefreshAtMs = nowMs + 60_000;
    }
    if (reconcile) {
      nextReconciliationAtMs = nowMs + 5 * 60_000;
    }
    inFlight = syncLocalAgentActivity({ reconcile, refreshContext })
      .then((result) => input.onResult?.(result))
      .catch((error) => input.onError?.(error))
      .finally(() => {
        inFlight = null;
        if (!stopped && (pendingContextRefresh || pendingReconciliation)) {
          queueMicrotask(run);
        }
      });
  };
  const timer = setInterval(run, input.intervalMs ?? 5000);
  timer.unref();
  run();
  return {
    requestSync: (request = {}) => {
      if (stopped) {
        return;
      }
      pendingReconciliation ||= request.reconcile !== false;
      pendingContextRefresh ||= request.refreshContext !== false;
      run();
    },
    stop: async () => {
      stopped = true;
      pendingContextRefresh = false;
      pendingReconciliation = false;
      clearInterval(timer);
      await inFlight;
      await stopWatchers();
    },
  };
}

async function unavailable(
  input: { rootDir?: string } | undefined,
  observedCount: number,
  reason: string
): Promise<AgentActivityLocalSyncResult> {
  const [health, controllerTaskHealth] = await readLocalReportingHealth(
    input?.rootDir
  );
  return {
    controllerTaskEventSubmittedCount: 0,
    controllerTaskHealth,
    health,
    observedCount,
    reason,
    sessionInventory: idleSessionInventoryResult(),
    status: "unavailable",
    submittedCount: 0,
  };
}

function idleSessionInventoryResult(): LocalAgentSessionInventorySyncResult {
  return {
    reason: null,
    sessionCount: 0,
    sourceCount: 0,
    status: "idle",
    submittedSourceCount: 0,
  };
}

async function readLocalReportingHealth(rootDir?: string) {
  return await Promise.all([
    readAgentActivityOutboxHealth({ rootDir }),
    readControllerTaskLifecycleOutboxHealth({ rootDir }),
  ]);
}
