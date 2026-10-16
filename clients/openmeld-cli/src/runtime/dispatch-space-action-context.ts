import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  executionContextAssignmentSchema,
  openMeldSpaceEgressActionSchema,
  organizationSkillRuntimeReleaseSelectionSchema,
  runtimeCoordinatorExecutionTokenEchoSchema,
  spaceMemberDirectoryEntrySchema,
} from "@openmeld/schemas";
import type {
  DispatchSpaceActionClosedReasonCode,
  DispatchSpaceActionReceipt,
  OpenMeldSpaceEgressAction,
  OrganizationSkillRuntimeReleaseSelection,
  SpaceContract,
  SpaceMemberDirectoryEntry,
} from "@openmeld/schemas/types";
import { isSelfWakeSpaceAction } from "@openmeld/space-mesh";
import { daemonRuntimeRootPath } from "../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../config/paths";
import {
  DISPATCH_OWNED_RUNTIME_MODE,
  OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV,
  OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
  OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV,
} from "./dispatch-runtime-env";

export const OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV =
  "OPENMELD_SPACE_ACTION_CONTEXT_PATH";

/** The local action context is known expired/closed/mismatched: a new ordinary action must be rejected, never recorded. */
export class DispatchSpaceActionClosedError extends Error {
  readonly receipt = "rejected_closed" as const;
  readonly reasonCode: DispatchSpaceActionClosedReasonCode;
  constructor(
    reasonCode: DispatchSpaceActionClosedReasonCode,
    message: string
  ) {
    super(message);
    this.name = "DispatchSpaceActionClosedError";
    this.reasonCode = reasonCode;
  }
}

/** Use only at a boundary that has positively rejected this call before recording. */
export class DispatchSpaceActionRejectedError extends Error {
  readonly reasonCode: Extract<
    DispatchSpaceActionReceipt,
    { status: "rejected_before_recording" }
  >["reasonCode"];

  constructor(
    reasonCode: DispatchSpaceActionRejectedError["reasonCode"],
    message: string
  ) {
    super(message);
    this.name = "DispatchSpaceActionRejectedError";
    this.reasonCode = reasonCode;
  }
}

const DISPATCH_SPACE_ACTION_CONTEXT_VERSION = 1 as const;
const DISPATCH_SPACE_ACTION_RECORD_VERSION = 1 as const;
const DEFAULT_CONTEXT_TTL_MS = 12 * 60 * 60 * 1000;

export type DispatchSpaceActionSendTargetReference =
  | {
      status: "loaded";
      projection: SpaceMemberDirectoryEntry[];
      referenceLines: string[];
    }
  | {
      status: "failed";
      errorMessage: string;
      projection: null;
      referenceLines: [];
    };

export type DispatchSpaceActionContext = {
  executionTokenEcho?: ReturnType<
    typeof runtimeCoordinatorExecutionTokenEchoSchema.parse
  >;
  organizationSkillReleases?: OrganizationSkillRuntimeReleaseSelection[];
  projectShell?: {
    boundaryRoot: string;
    executionContextId: string;
    ledgerRootPath: string;
    workspacePath: string;
    runtime: {
      binary: string;
      engineIdentity: string;
      kind: "docker" | "podman";
    };
  };
  workingCopyId?: string;
  version: typeof DISPATCH_SPACE_ACTION_CONTEXT_VERSION;
  actionRecordPath: string;
  attemptId: string;
  contextId: string;
  dispatchId: string;
  expiresAtMs: number;
  nonce: string;
  replyToSignalId: string | null;
  sendTargetReference: DispatchSpaceActionSendTargetReference;
  sourceEventId: string;
  spaceContractSnapshot: Pick<
    SpaceContract,
    "allowedActions" | "publicationMode"
  > | null;
  spaceId: string;
  targetProfileId: string;
  taskId: string;
};

export type DispatchSpaceActionRecord = {
  version: typeof DISPATCH_SPACE_ACTION_RECORD_VERSION;
  action: OpenMeldSpaceEgressAction;
  command: string;
  contextId: string;
  createdAtMs: number;
  nonce: string;
  previousReplyDigests?: string[];
};

export type DispatchSpaceActionRecordReadResult =
  | {
      status: "missing";
    }
  | {
      errorMessage: string;
      status: "invalid";
    }
  | {
      record: DispatchSpaceActionRecord;
      status: "loaded";
    };

export function createDispatchSpaceActionContext(input: {
  executionTokenEcho?: DispatchSpaceActionContext["executionTokenEcho"];
  organizationSkillReleases?: OrganizationSkillRuntimeReleaseSelection[];
  projectShell?: DispatchSpaceActionContext["projectShell"];
  workingCopyId?: string;
  attemptId: string;
  dispatchId: string;
  env?: Record<string, string | undefined>;
  pathInput?: OpenMeldPathResolutionInput;
  replyToSignalId?: string | null;
  sendTargetReference: DispatchSpaceActionSendTargetReference;
  sourceEventId: string;
  spaceContractSnapshot:
    | Pick<SpaceContract, "allowedActions" | "publicationMode">
    | null
    | undefined;
  spaceId: string;
  targetProfileId: string;
  taskId: string;
  ttlMs?: number;
}): {
  context: DispatchSpaceActionContext;
  contextPath: string;
} {
  const contextId = randomUUID();
  const nonce = randomUUID();
  const contextDir = join(
    daemonRuntimeRootPath(input.pathInput ?? { env: input.env }),
    "dispatch-space-actions",
    `${Date.now().toString(36)}-${contextId}`
  );
  mkdirSync(contextDir, { recursive: true, mode: 0o700 });
  chmodSync(contextDir, 0o700);

  const contextPath = join(contextDir, "context.json");
  const actionRecordPath = join(contextDir, "action.json");
  const context: DispatchSpaceActionContext = {
    ...(input.executionTokenEcho
      ? {
          executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema.parse(
            input.executionTokenEcho
          ),
        }
      : {}),
    ...(input.organizationSkillReleases
      ? { organizationSkillReleases: input.organizationSkillReleases }
      : {}),
    ...(input.projectShell ? { projectShell: input.projectShell } : {}),
    ...(input.workingCopyId ? { workingCopyId: input.workingCopyId } : {}),
    version: DISPATCH_SPACE_ACTION_CONTEXT_VERSION,
    actionRecordPath,
    attemptId: input.attemptId,
    contextId,
    dispatchId: input.dispatchId,
    expiresAtMs: Date.now() + (input.ttlMs ?? DEFAULT_CONTEXT_TTL_MS),
    nonce,
    replyToSignalId: normalizeOptionalText(input.replyToSignalId),
    sendTargetReference: input.sendTargetReference,
    sourceEventId: input.sourceEventId,
    spaceContractSnapshot: input.spaceContractSnapshot
      ? {
          allowedActions: input.spaceContractSnapshot.allowedActions,
          publicationMode: input.spaceContractSnapshot.publicationMode,
        }
      : null,
    spaceId: input.spaceId,
    targetProfileId: input.targetProfileId,
    taskId: input.taskId,
  };

  writeJsonFileExclusive(contextPath, context);
  return { context, contextPath };
}

export function readDispatchSpaceActionContextFromEnv(
  env: NodeJS.ProcessEnv = process.env
): DispatchSpaceActionContext {
  const context = readDispatchSpaceActionContextForReceiptFromEnv(env);
  assertContextActive(context, Date.now());
  return context;
}

// Expiry does not erase a prior receipt. Callers may use this context to compare
// an exact existing action; writeDispatchSpaceActionRecord still rejects new
// actions after expiry. File reads/uploads and target listing use the active
// context reader instead.
export function readDispatchSpaceActionContextForReceiptFromEnv(
  env: NodeJS.ProcessEnv = process.env
): DispatchSpaceActionContext {
  const contextPath = normalizeOptionalText(
    env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]
  );
  if (!contextPath) {
    throw new Error(
      "No active OpenMeld Space Action dispatch context was found. Use this command inside an OpenMeld Space Wake dispatch."
    );
  }
  const context = readDispatchSpaceActionContext(contextPath);
  assertDispatchRuntimeEnvMatchesContext({ context, env });
  return context;
}

export function readDispatchSpaceActionContext(
  contextPath: string
): DispatchSpaceActionContext {
  return parseDispatchSpaceActionContext(readJsonFile(contextPath));
}

export function writeDispatchSpaceActionRecord(input: {
  action: OpenMeldSpaceEgressAction;
  command: string;
  context: DispatchSpaceActionContext;
  nowMs?: number;
}): DispatchSpaceActionRecord {
  return withDispatchSpaceActionRecordLock(input.context, () =>
    writeLockedDispatchSpaceActionRecord(input)
  );
}

function withDispatchSpaceActionRecordLock<T>(
  context: DispatchSpaceActionContext,
  mutate: () => T
): T {
  // Serialize CLI and in-process writers. Never silently break a lock left by
  // an interrupted writer: the caller must reconcile the existing receipt.
  const lockPath = `${context.actionRecordPath}.lock`;
  mkdirSync(lockPath, { mode: 0o700 });
  try {
    return mutate();
  } finally {
    rmdirSync(lockPath);
  }
}

function replyDigest(action: OpenMeldSpaceEgressAction): string {
  return createHash("sha256").update(JSON.stringify(action)).digest("hex");
}

function appendReplyDigest(
  previousReplyDigests: string[],
  action: OpenMeldSpaceEgressAction
): string[] {
  if (previousReplyDigests.length >= 32) {
    throw new DispatchSpaceActionRejectedError(
      "space_action.already_recorded",
      "The reply revision limit has been reached. Read the current receipt."
    );
  }
  return [...previousReplyDigests, replyDigest(action)];
}

function readReconsideredReplyHistory(
  context: DispatchSpaceActionContext,
  action: OpenMeldSpaceEgressAction
): string[] {
  // The latest archive carries cumulative history, but is not an active draft.
  const archived = readDispatchSpaceActionRecord({
    context: {
      ...context,
      actionRecordPath: `${context.actionRecordPath}.superseded`,
    },
  });
  if (archived.status === "invalid") {
    throw new Error(archived.errorMessage);
  }
  if (archived.status === "missing") {
    return [];
  }
  const previousReplyDigests = archived.record.previousReplyDigests ?? [];
  if (
    action.type === "post_message" &&
    previousReplyDigests.includes(replyDigest(action))
  ) {
    throw new DispatchSpaceActionRejectedError(
      "space_action.already_recorded",
      "This reply version was already replaced. Read the current receipt."
    );
  }
  return archived.record.action.type === "post_message" &&
    !isDeepStrictEqual(archived.record.action, action)
    ? appendReplyDigest(previousReplyDigests, archived.record.action)
    : previousReplyDigests;
}

function writeLockedDispatchSpaceActionRecord(input: {
  action: OpenMeldSpaceEgressAction;
  command: string;
  context: DispatchSpaceActionContext;
  nowMs?: number;
}): DispatchSpaceActionRecord {
  const parsedAction = openMeldSpaceEgressActionSchema.safeParse(input.action);
  if (!parsedAction.success) {
    throw new DispatchSpaceActionRejectedError(
      "space_action.invalid_input",
      parsedAction.error.message
    );
  }
  if (isSelfWakeSpaceAction(parsedAction.data, input.context.targetProfileId)) {
    throw new DispatchSpaceActionRejectedError(
      "space_action.invalid_input",
      "An Agent cannot Wake itself. To reply to the current message, omit wakeTargets (CLI: --wake) and submit the reply again. No action was recorded."
    );
  }

  const existing = readDispatchSpaceActionRecord({ context: input.context });
  if (existing.status === "invalid") {
    throw new Error(existing.errorMessage);
  }
  if (
    existing.status === "loaded" &&
    isDeepStrictEqual(existing.record.action, parsedAction.data)
  ) {
    return existing.record;
  }
  assertContextActive(input.context, input.nowMs ?? Date.now());

  if (
    existing.status === "loaded" &&
    existing.record.action.type === "post_message" &&
    parsedAction.data.type === "post_message"
  ) {
    const previousReplyDigests = existing.record.previousReplyDigests ?? [];
    if (previousReplyDigests.includes(replyDigest(parsedAction.data))) {
      return existing.record;
    }
    const record: DispatchSpaceActionRecord = {
      version: DISPATCH_SPACE_ACTION_RECORD_VERSION,
      action: parsedAction.data,
      command: input.command,
      contextId: input.context.contextId,
      createdAtMs: input.nowMs ?? Date.now(),
      nonce: input.context.nonce,
      previousReplyDigests: appendReplyDigest(
        previousReplyDigests,
        existing.record.action
      ),
    };
    const temporaryPath = `${input.context.actionRecordPath}.${randomUUID()}.tmp`;
    writeJsonFileExclusive(temporaryPath, record);
    renameSync(temporaryPath, input.context.actionRecordPath);
    return record;
  }

  const previousReplyDigests =
    existing.status === "missing"
      ? readReconsideredReplyHistory(input.context, parsedAction.data)
      : [];
  const record: DispatchSpaceActionRecord = {
    version: DISPATCH_SPACE_ACTION_RECORD_VERSION,
    action: parsedAction.data,
    command: input.command,
    contextId: input.context.contextId,
    createdAtMs: input.nowMs ?? Date.now(),
    nonce: input.context.nonce,
    ...(previousReplyDigests.length ? { previousReplyDigests } : {}),
  };
  try {
    writeJsonFileExclusive(input.context.actionRecordPath, record);
  } catch (error) {
    if (isNodeErrorCode(error, "EEXIST")) {
      throw new DispatchSpaceActionRejectedError(
        "space_action.already_recorded",
        "An OpenMeld Space Action has already been recorded for this dispatch. A Wake can only have one final Space action. Recover its receipt with the exact original arguments; do not replace it with a different action."
      );
    }
    throw error;
  }
  return record;
}

export function readDispatchSpaceActionRecord(input: {
  context: DispatchSpaceActionContext;
  nowMs?: number;
}): DispatchSpaceActionRecordReadResult {
  if (!existsSync(input.context.actionRecordPath)) {
    return { status: "missing" };
  }
  try {
    const record = parseDispatchSpaceActionRecord(
      readJsonFile(input.context.actionRecordPath)
    );
    if (
      record.contextId !== input.context.contextId ||
      record.nonce !== input.context.nonce
    ) {
      return {
        status: "invalid",
        errorMessage:
          "OpenMeld Space Action record does not match the active dispatch context.",
      };
    }
    if (record.createdAtMs > input.context.expiresAtMs) {
      return {
        status: "invalid",
        errorMessage:
          "OpenMeld Space Action record was created after the active dispatch context expired.",
      };
    }
    return { status: "loaded", record };
  } catch (error) {
    return {
      status: "invalid",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function supersedeDispatchSpaceActionRecordForReconsideration(input: {
  context: DispatchSpaceActionContext;
  nowMs?: number;
}): { archivedPath: string; record: DispatchSpaceActionRecord } | null {
  return withDispatchSpaceActionRecordLock(input.context, () => {
    const readResult = readDispatchSpaceActionRecord(input);
    if (readResult.status === "missing") {
      return null;
    }
    if (readResult.status === "invalid") {
      throw new Error(readResult.errorMessage);
    }
    const archivedPath = `${input.context.actionRecordPath}.superseded`;
    renameSync(input.context.actionRecordPath, archivedPath);
    return { archivedPath, record: readResult.record };
  });
}

function parseDispatchSpaceActionContext(
  value: unknown
): DispatchSpaceActionContext {
  const record = toRecord(value, "OpenMeld Space Action context");
  const version = record.version;
  if (version !== DISPATCH_SPACE_ACTION_CONTEXT_VERSION) {
    throw new Error("Unsupported OpenMeld Space Action context version.");
  }
  const sendTargetReference = parseSendTargetReference(
    record.sendTargetReference
  );
  return {
    ...(record.projectShell
      ? { projectShell: parseProjectShell(record.projectShell) }
      : {}),
    ...(record.executionTokenEcho
      ? {
          executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema.parse(
            record.executionTokenEcho
          ),
        }
      : {}),
    version,
    ...(record.organizationSkillReleases
      ? {
          organizationSkillReleases:
            organizationSkillRuntimeReleaseSelectionSchema
              .array()
              .parse(record.organizationSkillReleases),
        }
      : {}),
    actionRecordPath: requiredString(
      record.actionRecordPath,
      "actionRecordPath"
    ),
    attemptId: requiredString(record.attemptId, "attemptId"),
    contextId: requiredString(record.contextId, "contextId"),
    dispatchId: requiredString(record.dispatchId, "dispatchId"),
    expiresAtMs: requiredFiniteNumber(record.expiresAtMs, "expiresAtMs"),
    nonce: requiredString(record.nonce, "nonce"),
    replyToSignalId: optionalString(record.replyToSignalId),
    sendTargetReference,
    sourceEventId: requiredString(record.sourceEventId, "sourceEventId"),
    spaceContractSnapshot: parseSpaceContractSnapshot(
      record.spaceContractSnapshot
    ),
    spaceId: requiredString(record.spaceId, "spaceId"),
    targetProfileId: requiredString(record.targetProfileId, "targetProfileId"),
    taskId: requiredString(record.taskId, "taskId"),
    ...(record.workingCopyId
      ? { workingCopyId: requiredString(record.workingCopyId, "workingCopyId") }
      : {}),
  };
}

function parseProjectShell(
  value: unknown
): NonNullable<DispatchSpaceActionContext["projectShell"]> {
  const record = toRecord(value, "OpenMeld project shell context");
  const runtime = toRecord(record.runtime, "OpenMeld project shell runtime");
  const kind = runtime.kind;
  if (kind !== "docker" && kind !== "podman") {
    throw new Error("OpenMeld project shell runtime is invalid.");
  }
  const executionContextId = requiredString(
    record.executionContextId,
    "executionContextId"
  );
  const workspacePath = requiredString(record.workspacePath, "workspacePath");
  const boundaryRoot = requiredString(record.boundaryRoot, "boundaryRoot");
  const ledgerRootPath = requiredString(
    record.ledgerRootPath,
    "ledgerRootPath"
  );
  const binary = requiredString(runtime.binary, "binary");
  const validContextId =
    executionContextAssignmentSchema.shape.id.safeParse(
      executionContextId
    ).success;
  const validPaths = [
    workspacePath,
    boundaryRoot,
    ledgerRootPath,
    binary,
  ].every(isAbsolute);
  if (!(validContextId && validPaths)) {
    throw new Error("OpenMeld project shell context is invalid.");
  }
  return {
    boundaryRoot,
    executionContextId,
    ledgerRootPath,
    workspacePath,
    runtime: {
      binary,
      engineIdentity: requiredString(runtime.engineIdentity, "engineIdentity"),
      kind,
    },
  };
}

function assertDispatchRuntimeEnvMatchesContext(input: {
  context: DispatchSpaceActionContext;
  env: NodeJS.ProcessEnv;
}): void {
  const mode = normalizeOptionalText(
    input.env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV]
  );
  if (mode !== DISPATCH_OWNED_RUNTIME_MODE) {
    return;
  }

  const envDispatchId = normalizeOptionalText(
    input.env[OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV]
  );
  if (!envDispatchId) {
    throw new Error(
      "OpenMeld Space Action dispatch runtime is missing the active dispatch ID."
    );
  }
  if (envDispatchId !== input.context.dispatchId) {
    throw new DispatchSpaceActionClosedError(
      "space_action.context_mismatch",
      "OpenMeld Space Action dispatch context does not match the active dispatch runtime."
    );
  }

  const envTargetProfileId = normalizeOptionalText(
    input.env[OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV]
  );
  if (!envTargetProfileId) {
    throw new Error(
      "OpenMeld Space Action dispatch runtime is missing the active target profile ID."
    );
  }
  if (envTargetProfileId !== input.context.targetProfileId) {
    throw new DispatchSpaceActionClosedError(
      "space_action.context_mismatch",
      "OpenMeld Space Action target profile does not match the active dispatch runtime."
    );
  }
}

function parseDispatchSpaceActionRecord(
  value: unknown
): DispatchSpaceActionRecord {
  const record = toRecord(value, "OpenMeld Space Action record");
  const version = record.version;
  if (version !== DISPATCH_SPACE_ACTION_RECORD_VERSION) {
    throw new Error("Unsupported OpenMeld Space Action record version.");
  }
  const parsedAction = openMeldSpaceEgressActionSchema.safeParse(record.action);
  if (!parsedAction.success) {
    throw parsedAction.error;
  }
  return {
    version,
    action: parsedAction.data,
    command: requiredString(record.command, "command"),
    contextId: requiredString(record.contextId, "contextId"),
    createdAtMs: requiredFiniteNumber(record.createdAtMs, "createdAtMs"),
    nonce: requiredString(record.nonce, "nonce"),
    ...(record.previousReplyDigests === undefined
      ? {}
      : {
          previousReplyDigests: parseStringArray(record.previousReplyDigests),
        }),
  };
}

function parseSendTargetReference(
  value: unknown
): DispatchSpaceActionSendTargetReference {
  const record = toRecord(value, "sendTargetReference");
  if (record.status === "loaded") {
    if (!Array.isArray(record.projection)) {
      throw new Error(
        "OpenMeld Space Action send target projection must be an array."
      );
    }
    return {
      status: "loaded",
      projection: record.projection.map(parseSendTargetProjectionEntry),
      referenceLines: parseStringArray(record.referenceLines),
    };
  }
  if (record.status === "failed") {
    return {
      status: "failed",
      errorMessage: requiredString(record.errorMessage, "errorMessage"),
      projection: null,
      referenceLines: [],
    };
  }
  throw new Error(
    "Invalid OpenMeld Space Action send target reference status."
  );
}

function parseSendTargetProjectionEntry(
  value: unknown,
  index: number
): SpaceMemberDirectoryEntry {
  const parsed = spaceMemberDirectoryEntrySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `OpenMeld Space Action target projection entry ${index} is not a valid Space member directory entry.`
    );
  }
  return parsed.data;
}

function parseSpaceContractSnapshot(
  value: unknown
): Pick<SpaceContract, "allowedActions" | "publicationMode"> | null {
  if (value === null || value === undefined) {
    return null;
  }
  const record = toRecord(value, "spaceContractSnapshot");
  return {
    allowedActions: Array.isArray(record.allowedActions)
      ? (record.allowedActions as SpaceContract["allowedActions"])
      : [],
    publicationMode:
      record.publicationMode === "raw_context_sharing"
        ? "raw_context_sharing"
        : "collaboration",
  };
}

function assertContextActive(
  context: DispatchSpaceActionContext,
  nowMs: number
): void {
  if (nowMs > context.expiresAtMs) {
    throw new DispatchSpaceActionClosedError(
      "space_action.context_expired",
      "The OpenMeld Space Action dispatch context has expired."
    );
  }
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function writeJsonFileExclusive(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

function toRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, fieldName: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
}

function requiredFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeOptionalText(value);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeOptionalText(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
