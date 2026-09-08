import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  openMeldSpaceEgressActionSchema,
  spaceMemberDirectoryEntrySchema,
} from "@openmeld/schemas";
import type {
  OpenMeldSpaceEgressAction,
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
  assertContextActive(input.context, input.nowMs ?? Date.now());
  const parsedAction = openMeldSpaceEgressActionSchema.safeParse(input.action);
  if (!parsedAction.success) {
    throw parsedAction.error;
  }
  if (isSelfWakeSpaceAction(parsedAction.data, input.context.targetProfileId)) {
    throw new Error(
      "An Agent cannot Wake itself. To reply to the current message, omit wakeTargets (CLI: --wake) and submit the reply again. No action was recorded."
    );
  }

  const record: DispatchSpaceActionRecord = {
    version: DISPATCH_SPACE_ACTION_RECORD_VERSION,
    action: parsedAction.data,
    command: input.command,
    contextId: input.context.contextId,
    createdAtMs: input.nowMs ?? Date.now(),
    nonce: input.context.nonce,
  };
  try {
    writeJsonFileExclusive(input.context.actionRecordPath, record);
  } catch (error) {
    if (isNodeErrorCode(error, "EEXIST")) {
      const existing = readDispatchSpaceActionRecord({
        context: input.context,
      });
      // A lost acknowledgement may cause the same proposal to be submitted
      // again. Acknowledge that record, never replace it or accept a new action.
      if (
        existing.status === "loaded" &&
        isDeepStrictEqual(existing.record.action, parsedAction.data)
      ) {
        return existing.record;
      }
      throw new Error(
        "An OpenMeld Space Action has already been recorded for this dispatch. A Wake can only have one final Space action."
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
  const readResult = readDispatchSpaceActionRecord(input);
  if (readResult.status === "missing") {
    return null;
  }
  if (readResult.status === "invalid") {
    throw new Error(readResult.errorMessage);
  }
  const archivedPath = `${input.context.actionRecordPath}.superseded-${String(input.nowMs ?? Date.now())}-${randomUUID()}`;
  renameSync(input.context.actionRecordPath, archivedPath);
  return { archivedPath, record: readResult.record };
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
    version,
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
    throw new Error(
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
    throw new Error(
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
    throw new Error("The OpenMeld Space Action dispatch context has expired.");
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
