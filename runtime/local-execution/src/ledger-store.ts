import {
  canonicalizeAgentControllerRef,
  conversationExecutionStateSchema,
  parseAgentControllerRef,
  runtimeTransportModeSchema,
} from "@openmeld/schemas";
import type {
  ConversationExecutionState,
  RuntimeTransportMode,
} from "@openmeld/schemas/types";

export const LEDGER_STATE_VERSION = 2 as const;
const EXECUTION_CONTEXT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LEDGER_STATE_INVALID_JSON_ERROR = "ledger.state.invalid_json";
export const LEDGER_STATE_SCHEMA_ERROR = "ledger.state.schema_invalid";
export const LEDGER_STATE_BACKUP_ERROR = "ledger.state.backup_failed";

export type LedgerInvalidStateStrategy = "throw" | "backup_and_reset";

const UTF8_ENCODING = "utf8";
const EMPTY_PROMISE: Promise<void> = Promise.resolve();
const historyWriteQueueByPath = new Map<string, Promise<void>>();
const stateWriteQueueByPath = new Map<string, Promise<void>>();
const historySizeByPath = new Map<string, number>();
const HISTORY_ROTATION_MAX_BYTES = 4 * 1024 * 1024;
const HISTORY_ROTATION_MAX_ARCHIVES = 3;
const DEDUPE_RETENTION_MS = 48 * 60 * 60 * 1000;
const INFLIGHT_RETENTION_MS = DEDUPE_RETENTION_MS;
const AGENT_CONTEXT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AGENT_CONTEXT_MAX_ENTRIES = 2000;
const AGENT_CONTEXT_LOOKUP_KEY_SEPARATOR = "|";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && typeof value === "number" && value >= 0;

const isRuntimeTransportMode = (
  value: unknown
): value is RuntimeTransportMode =>
  runtimeTransportModeSchema.safeParse(value).success;

const utf8ByteLength = (value: string): number => {
  let byteLength = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      byteLength += 1;
      continue;
    }
    if (codePoint <= 0x7_ff) {
      byteLength += 2;
      continue;
    }
    if (codePoint <= 0xff_ff) {
      byteLength += 3;
      continue;
    }
    byteLength += 4;
  }
  return byteLength;
};

const toErrorCode = (error: unknown): string | null => {
  if (!isRecord(error)) {
    return null;
  }
  const code = error.code;
  if (typeof code !== "string") {
    return null;
  }
  return code;
};

const encodeAgentContextLookupKeyPart = (value: string): string =>
  encodeURIComponent(value);

const buildStoredAgentContextLookupKey = (input: {
  executionContextId?: string;
  agentControllerRef: string;
  runtimeWorkspaceFingerprint: string;
  targetProfileId: string;
  transportMode: RuntimeTransportMode;
}): string =>
  [
    ...(input.executionContextId
      ? ["execution-context", input.executionContextId]
      : []),
    input.targetProfileId,
    input.agentControllerRef,
    input.transportMode,
    input.runtimeWorkspaceFingerprint,
  ]
    .map(encodeAgentContextLookupKeyPart)
    .join(AGENT_CONTEXT_LOOKUP_KEY_SEPARATOR);

const buildLegacySpaceScopedAgentContextLookupKey = (input: {
  agentControllerRef: string;
  runtimeWorkspaceFingerprint: string;
  spaceId: string;
  targetProfileId: string;
  transportMode: RuntimeTransportMode;
}): string =>
  [
    input.spaceId,
    input.targetProfileId,
    input.agentControllerRef,
    input.transportMode,
    input.runtimeWorkspaceFingerprint,
  ]
    .map(encodeAgentContextLookupKeyPart)
    .join(AGENT_CONTEXT_LOOKUP_KEY_SEPARATOR);

export type OpenMeldDaemonInflightTaskState = {
  taskId: string;
  bindingKey: string;
  sequence: number;
  idempotencyKey: string;
  firstSeenAtMs: number;
  output?: string;
};

export type OpenMeldDaemonAgentContextState = {
  agentContextLookupKey: string;
  spaceId: string;
  targetProfileId: string;
  agentControllerRef: string;
  transportMode: RuntimeTransportMode;
  runtimeWorkspaceFingerprint: string;
  agentControllerConversationId: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastTaskId: string;
};

export type OpenMeldDaemonAgentContextLifecycleCounters = {
  created: number;
  recreated: number;
  reused: number;
  guardBlocked: number;
};

export type OpenMeldDaemonAgentContextRotationRecord = {
  previousAgentControllerConversationId: string;
  nextAgentControllerConversationId: string;
  rotationTriggerErrorCode: string;
  rotationReason: string;
  rotationAt: number;
  rotationTaskId: string;
};

export type OpenMeldDaemonLedgerState = {
  v: typeof LEDGER_STATE_VERSION;
  updatedAtMs: number;
  dedupeFirstSeenByKey: Record<string, number>;
  inflightByTaskId: Record<string, OpenMeldDaemonInflightTaskState>;
  replayedTaskIds: Record<string, true>;
  agentContextByLookupKey: Record<string, OpenMeldDaemonAgentContextState>;
  bootstrapExecutionByLookupKey: Record<string, ConversationExecutionState>;
  agentContextLifecycleCounters: OpenMeldDaemonAgentContextLifecycleCounters;
  agentContextRotations: OpenMeldDaemonAgentContextRotationRecord[];
};

export type OpenMeldDaemonHistoryEntry = {
  ts: string;
  taskId: string;
  status: "success" | "partial_success" | "failed";
  reasonCode: string;
  message: string;
};

export type LedgerPaths = {
  rootDirPath: string;
  stateFilePath: string;
  stateTempFilePath: string;
  historyFilePath: string;
  historyTempFilePath: string;
  backupStateFilePath?: string;
};

export type LedgerFileIo = {
  appendFile: (
    filePath: string,
    content: string,
    encoding: "utf8"
  ) => Promise<void>;
  copyFile: (fromPath: string, toPath: string) => Promise<void>;
  mkdir: (
    dirPath: string,
    options: {
      recursive: boolean;
    }
  ) => Promise<void>;
  readFile: (filePath: string, encoding: "utf8") => Promise<string>;
  rename: (fromPath: string, toPath: string) => Promise<void>;
  rm: (
    filePath: string,
    options: {
      force: boolean;
    }
  ) => Promise<void>;
  writeFile: (
    filePath: string,
    content: string,
    encoding: "utf8"
  ) => Promise<void>;
};

type LedgerStateTransactionResult<T> = {
  nextState: OpenMeldDaemonLedgerState;
  value: T;
};

const parseInflightTask = (
  value: unknown
): OpenMeldDaemonInflightTaskState | null => {
  if (!isRecord(value)) {
    return null;
  }
  const {
    bindingKey,
    firstSeenAtMs,
    idempotencyKey,
    output,
    sequence,
    taskId,
  } = value;

  if (
    typeof taskId !== "string" ||
    taskId.length === 0 ||
    typeof bindingKey !== "string" ||
    bindingKey.length === 0 ||
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length === 0 ||
    !isPositiveInteger(sequence) ||
    !isPositiveInteger(firstSeenAtMs)
  ) {
    return null;
  }

  if (
    output !== undefined &&
    (typeof output !== "string" || output.length === 0)
  ) {
    return null;
  }

  return {
    bindingKey,
    firstSeenAtMs,
    idempotencyKey,
    ...(output ? { output } : {}),
    sequence,
    taskId,
  };
};

const parseAgentContextState = (
  agentContextLookupKey: string,
  value: unknown
): OpenMeldDaemonAgentContextState | null => {
  if (!isRecord(value)) {
    return null;
  }

  const {
    agentControllerConversationId,
    agentControllerRef,
    createdAtMs,
    lastTaskId,
    spaceId,
    targetProfileId,
    transportMode,
    runtimeWorkspaceFingerprint,
    updatedAtMs,
  } = value;

  const parsedAgentControllerRef =
    typeof agentControllerRef === "string"
      ? parseAgentControllerRef(agentControllerRef)
      : null;

  if (
    !isRuntimeTransportMode(transportMode) ||
    typeof agentContextLookupKey !== "string" ||
    agentContextLookupKey.length === 0 ||
    typeof spaceId !== "string" ||
    spaceId.length === 0 ||
    typeof targetProfileId !== "string" ||
    targetProfileId.length === 0 ||
    !parsedAgentControllerRef ||
    typeof runtimeWorkspaceFingerprint !== "string" ||
    runtimeWorkspaceFingerprint.length === 0 ||
    typeof agentControllerConversationId !== "string" ||
    agentControllerConversationId.length === 0 ||
    !isPositiveInteger(createdAtMs) ||
    !isPositiveInteger(updatedAtMs) ||
    typeof lastTaskId !== "string" ||
    lastTaskId.length === 0
  ) {
    return null;
  }

  let executionContextId: string | undefined;
  if (agentContextLookupKey.startsWith("execution-context|")) {
    executionContextId = agentContextLookupKey.split("|")[1];
    if (
      !(
        executionContextId &&
        EXECUTION_CONTEXT_ID_PATTERN.test(executionContextId)
      )
    ) {
      return null;
    }
  }
  const canonicalLookupKey = buildStoredAgentContextLookupKey({
    executionContextId,
    agentControllerRef: parsedAgentControllerRef.ref,
    runtimeWorkspaceFingerprint,
    targetProfileId,
    transportMode,
  });
  const legacySpaceScopedLookupKey =
    buildLegacySpaceScopedAgentContextLookupKey({
      agentControllerRef: parsedAgentControllerRef.ref,
      runtimeWorkspaceFingerprint,
      spaceId,
      targetProfileId,
      transportMode,
    });
  if (
    agentContextLookupKey !== canonicalLookupKey &&
    agentContextLookupKey !== legacySpaceScopedLookupKey
  ) {
    return null;
  }

  return {
    agentControllerConversationId,
    agentControllerRef: parsedAgentControllerRef.ref,
    createdAtMs,
    lastTaskId,
    agentContextLookupKey,
    spaceId,
    targetProfileId,
    transportMode,
    runtimeWorkspaceFingerprint,
    updatedAtMs,
  };
};

const parseAgentContextLifecycleCounters = (
  value: unknown
): OpenMeldDaemonAgentContextLifecycleCounters | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { created, guardBlocked, recreated, reused } = value;
  if (
    !(
      isPositiveInteger(created) &&
      isPositiveInteger(recreated) &&
      isPositiveInteger(reused) &&
      isPositiveInteger(guardBlocked)
    )
  ) {
    return null;
  }
  return {
    created,
    guardBlocked,
    recreated,
    reused,
  };
};

const createEmptyAgentContextLifecycleCounters =
  (): OpenMeldDaemonAgentContextLifecycleCounters => ({
    created: 0,
    guardBlocked: 0,
    recreated: 0,
    reused: 0,
  });

const parseAgentContextRotationRecord = (
  value: unknown
): OpenMeldDaemonAgentContextRotationRecord | null => {
  if (!isRecord(value)) {
    return null;
  }
  const {
    nextAgentControllerConversationId,
    previousAgentControllerConversationId,
    rotationAt,
    rotationReason,
    rotationTaskId,
    rotationTriggerErrorCode,
  } = value;
  if (
    typeof previousAgentControllerConversationId !== "string" ||
    previousAgentControllerConversationId.length === 0 ||
    typeof nextAgentControllerConversationId !== "string" ||
    nextAgentControllerConversationId.length === 0 ||
    typeof rotationTriggerErrorCode !== "string" ||
    rotationTriggerErrorCode.length === 0 ||
    typeof rotationReason !== "string" ||
    rotationReason.length === 0 ||
    !isPositiveInteger(rotationAt) ||
    typeof rotationTaskId !== "string" ||
    rotationTaskId.length === 0
  ) {
    return null;
  }
  return {
    nextAgentControllerConversationId,
    previousAgentControllerConversationId,
    rotationAt,
    rotationReason,
    rotationTaskId,
    rotationTriggerErrorCode,
  };
};

const parseAgentContextRotationsOrDefault = (
  value: unknown
): OpenMeldDaemonAgentContextRotationRecord[] | null => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const nextRecords: OpenMeldDaemonAgentContextRotationRecord[] = [];
  for (const item of value) {
    const parsed = parseAgentContextRotationRecord(item);
    if (!parsed) {
      return null;
    }
    nextRecords.push(parsed);
  }
  return nextRecords;
};

const parseDedupeFirstSeenByKey = (
  value: unknown
): Record<string, number> | null => {
  if (!isRecord(value)) {
    return null;
  }
  const nextDedupeFirstSeenByKey: Record<string, number> = {};
  for (const [key, firstSeenAtMs] of Object.entries(value)) {
    if (!isPositiveInteger(firstSeenAtMs)) {
      return null;
    }
    nextDedupeFirstSeenByKey[key] = firstSeenAtMs;
  }
  return nextDedupeFirstSeenByKey;
};

const parseInflightByTaskId = (
  value: unknown
): Record<string, OpenMeldDaemonInflightTaskState> | null => {
  if (!isRecord(value)) {
    return null;
  }
  const nextInflightByTaskId: Record<string, OpenMeldDaemonInflightTaskState> =
    {};
  for (const [taskId, inflightTask] of Object.entries(value)) {
    const parsedTask = parseInflightTask(inflightTask);
    if (!parsedTask || parsedTask.taskId !== taskId) {
      return null;
    }
    nextInflightByTaskId[taskId] = parsedTask;
  }
  return nextInflightByTaskId;
};

const parseReplayedTaskIds = (value: unknown): Record<string, true> | null => {
  if (!isRecord(value)) {
    return null;
  }
  const nextReplayedTaskIds: Record<string, true> = {};
  for (const [taskId, replayed] of Object.entries(value)) {
    if (replayed !== true) {
      return null;
    }
    nextReplayedTaskIds[taskId] = true;
  }
  return nextReplayedTaskIds;
};

const parseAgentContextByLookupKey = (
  value: unknown
): Record<string, OpenMeldDaemonAgentContextState> | null => {
  if (!isRecord(value)) {
    return null;
  }
  const nextAgentContextByLookupKey: Record<
    string,
    OpenMeldDaemonAgentContextState
  > = {};
  for (const [agentContextLookupKey, rawAgentContextState] of Object.entries(
    value
  )) {
    const parsedAgentContextState = parseAgentContextState(
      agentContextLookupKey,
      rawAgentContextState
    );
    if (!parsedAgentContextState) {
      return null;
    }
    nextAgentContextByLookupKey[agentContextLookupKey] =
      parsedAgentContextState;
  }
  return nextAgentContextByLookupKey;
};

const parseAgentContextLifecycleCountersOrDefault = (
  value: unknown
): OpenMeldDaemonAgentContextLifecycleCounters | null =>
  parseAgentContextLifecycleCounters(value);

const parseBootstrapExecutionByLookupKey = (
  value: unknown
): Record<string, ConversationExecutionState> | null => {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return null;
  }

  const nextBootstrapExecutionByLookupKey: Record<
    string,
    ConversationExecutionState
  > = {};
  for (const [agentContextLookupKey, executionState] of Object.entries(value)) {
    const parsedExecutionState =
      conversationExecutionStateSchema.safeParse(executionState);
    if (!parsedExecutionState.success) {
      return null;
    }
    if (
      parsedExecutionState.data.agentContextLookupKey !== agentContextLookupKey
    ) {
      return null;
    }
    nextBootstrapExecutionByLookupKey[agentContextLookupKey] =
      parsedExecutionState.data;
  }
  return nextBootstrapExecutionByLookupKey;
};

const decodeLedgerState = (
  value: unknown
): OpenMeldDaemonLedgerState | null => {
  if (!isRecord(value)) {
    return null;
  }

  const {
    agentContextRotations,
    dedupeFirstSeenByKey,
    inflightByTaskId,
    replayedTaskIds,
    agentContextByLookupKey,
    bootstrapExecutionByLookupKey,
    agentContextLifecycleCounters,
    updatedAtMs,
    v,
  } = value;

  if (
    (v !== LEDGER_STATE_VERSION && v !== 1) ||
    !isPositiveInteger(updatedAtMs)
  ) {
    return null;
  }

  const nextDedupeFirstSeenByKey =
    parseDedupeFirstSeenByKey(dedupeFirstSeenByKey);
  const nextInflightByTaskId = parseInflightByTaskId(inflightByTaskId);
  const nextReplayedTaskIds = parseReplayedTaskIds(replayedTaskIds);
  const nextAgentContextByLookupKey = parseAgentContextByLookupKey(
    agentContextByLookupKey
  );
  const nextBootstrapExecutionByLookupKey = parseBootstrapExecutionByLookupKey(
    bootstrapExecutionByLookupKey
  );
  const nextAgentContextLifecycleCounters =
    parseAgentContextLifecycleCountersOrDefault(agentContextLifecycleCounters);
  const nextAgentContextRotations = parseAgentContextRotationsOrDefault(
    agentContextRotations
  );

  if (
    !(
      nextDedupeFirstSeenByKey &&
      nextInflightByTaskId &&
      nextReplayedTaskIds &&
      nextAgentContextByLookupKey &&
      nextBootstrapExecutionByLookupKey &&
      nextAgentContextLifecycleCounters &&
      nextAgentContextRotations
    )
  ) {
    return null;
  }

  return {
    dedupeFirstSeenByKey: nextDedupeFirstSeenByKey,
    inflightByTaskId: nextInflightByTaskId,
    replayedTaskIds: nextReplayedTaskIds,
    agentContextByLookupKey: nextAgentContextByLookupKey,
    bootstrapExecutionByLookupKey: nextBootstrapExecutionByLookupKey,
    agentContextLifecycleCounters: nextAgentContextLifecycleCounters,
    agentContextRotations: nextAgentContextRotations,
    updatedAtMs,
    v: LEDGER_STATE_VERSION,
  };
};

const serializeLedgerState = (state: OpenMeldDaemonLedgerState): string =>
  `${JSON.stringify(state, null, 2)}\n`;

const cloneLedgerState = (
  state: OpenMeldDaemonLedgerState
): OpenMeldDaemonLedgerState => ({
  dedupeFirstSeenByKey: { ...state.dedupeFirstSeenByKey },
  inflightByTaskId: Object.fromEntries(
    Object.entries(state.inflightByTaskId).map(([taskId, taskState]) => [
      taskId,
      {
        ...taskState,
      },
    ])
  ),
  replayedTaskIds: { ...state.replayedTaskIds },
  agentContextByLookupKey: Object.fromEntries(
    Object.entries(state.agentContextByLookupKey).map(
      ([agentContextLookupKey, sessionState]) => [
        agentContextLookupKey,
        {
          ...sessionState,
        },
      ]
    )
  ),
  bootstrapExecutionByLookupKey: Object.fromEntries(
    Object.entries(state.bootstrapExecutionByLookupKey).map(
      ([agentContextLookupKey, executionState]) => [
        agentContextLookupKey,
        {
          ...executionState,
          ...(executionState.lastResolvedAgentControllerConversation
            ? {
                lastResolvedAgentControllerConversation: {
                  ...executionState.lastResolvedAgentControllerConversation,
                },
              }
            : {}),
        },
      ]
    )
  ),
  agentContextLifecycleCounters: {
    ...state.agentContextLifecycleCounters,
  },
  agentContextRotations: state.agentContextRotations.map((record) => ({
    ...record,
  })),
  updatedAtMs: state.updatedAtMs,
  v: LEDGER_STATE_VERSION,
});

const buildHistoryArchivePath = (
  historyFilePath: string,
  index: number
): string => {
  const suffix = ".ndjson";
  if (historyFilePath.endsWith(suffix)) {
    return `${historyFilePath.slice(0, -suffix.length)}.${String(index)}${suffix}`;
  }
  return `${historyFilePath}.${String(index)}`;
};

const resolveHistoryFileSize = async (input: {
  historyFilePath: string;
  io: LedgerFileIo;
}): Promise<number> => {
  const cachedSize = historySizeByPath.get(input.historyFilePath);
  if (typeof cachedSize === "number") {
    return cachedSize;
  }
  try {
    const content = await input.io.readFile(
      input.historyFilePath,
      UTF8_ENCODING
    );
    const size = utf8ByteLength(content);
    historySizeByPath.set(input.historyFilePath, size);
    return size;
  } catch (error) {
    if (toErrorCode(error) === "ENOENT") {
      historySizeByPath.set(input.historyFilePath, 0);
      return 0;
    }
    throw error;
  }
};

const rotateHistoryIfNeeded = async (input: {
  io: LedgerFileIo;
  maxBytes: number;
  maxArchives: number;
  nextLineBytes: number;
  paths: LedgerPaths;
}): Promise<number> => {
  const currentSize = await resolveHistoryFileSize({
    historyFilePath: input.paths.historyFilePath,
    io: input.io,
  });
  if (currentSize + input.nextLineBytes <= input.maxBytes) {
    return currentSize;
  }

  for (let index = input.maxArchives; index >= 1; index -= 1) {
    const sourcePath =
      index === 1
        ? input.paths.historyFilePath
        : buildHistoryArchivePath(input.paths.historyFilePath, index - 1);
    const targetPath = buildHistoryArchivePath(
      input.paths.historyFilePath,
      index
    );
    await input.io.rm(targetPath, { force: true }).catch(() => undefined);
    await input.io.rename(sourcePath, targetPath).catch((error) => {
      if (toErrorCode(error) === "ENOENT") {
        return;
      }
      throw error;
    });
  }

  historySizeByPath.set(input.paths.historyFilePath, 0);
  return 0;
};

export const compactLedgerState = (input: {
  maxAgentContexts?: number;
  nowMs?: number;
  state: OpenMeldDaemonLedgerState;
}): OpenMeldDaemonLedgerState => {
  const persistedAtMs = input.nowMs ?? Date.now();
  const maxAgentContexts =
    typeof input.maxAgentContexts === "number" &&
    Number.isFinite(input.maxAgentContexts) &&
    input.maxAgentContexts > 0
      ? Math.trunc(input.maxAgentContexts)
      : AGENT_CONTEXT_MAX_ENTRIES;
  const referenceNowMs = resolveCompactionReferenceNowMs({
    fallbackNowMs: persistedAtMs,
    state: input.state,
  });
  const dedupeCutoffMs = referenceNowMs - DEDUPE_RETENTION_MS;
  const inflightCutoffMs = referenceNowMs - INFLIGHT_RETENTION_MS;
  const agentContextCutoffMs = referenceNowMs - AGENT_CONTEXT_RETENTION_MS;

  const nextDedupeFirstSeenByKey = Object.fromEntries(
    Object.entries(input.state.dedupeFirstSeenByKey).filter(
      ([, firstSeenAtMs]) => firstSeenAtMs >= dedupeCutoffMs
    )
  );
  const nextInflightByTaskId = Object.fromEntries(
    Object.entries(input.state.inflightByTaskId)
      .filter(([, taskState]) => taskState.firstSeenAtMs >= inflightCutoffMs)
      .map(([taskId, taskState]) => [
        taskId,
        {
          ...taskState,
        },
      ])
  );
  const inflightTaskIdSet = new Set(Object.keys(nextInflightByTaskId));
  const nextReplayedTaskIds = Object.fromEntries(
    Object.entries(input.state.replayedTaskIds).filter(
      ([taskId, replayed]) => replayed === true && inflightTaskIdSet.has(taskId)
    )
  );

  const filteredAgentContexts = Object.entries(
    input.state.agentContextByLookupKey
  )
    .filter(([, context]) => context.updatedAtMs >= agentContextCutoffMs)
    .sort((left, right) => {
      if (left[1].updatedAtMs !== right[1].updatedAtMs) {
        return right[1].updatedAtMs - left[1].updatedAtMs;
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, maxAgentContexts);

  const nextAgentContextByLookupKey: Record<
    string,
    OpenMeldDaemonAgentContextState
  > = Object.fromEntries(filteredAgentContexts);
  const nextBootstrapExecutionByLookupKey = Object.fromEntries(
    Object.entries(input.state.bootstrapExecutionByLookupKey).filter(
      ([agentContextLookupKey, executionState]) => {
        if (agentContextLookupKey in nextAgentContextByLookupKey) {
          return true;
        }
        const updatedAtMs = Date.parse(executionState.updatedAt);
        return (
          Number.isFinite(updatedAtMs) && updatedAtMs >= agentContextCutoffMs
        );
      }
    )
  );

  return {
    dedupeFirstSeenByKey: nextDedupeFirstSeenByKey,
    inflightByTaskId: nextInflightByTaskId,
    replayedTaskIds: nextReplayedTaskIds,
    agentContextByLookupKey: nextAgentContextByLookupKey,
    bootstrapExecutionByLookupKey: nextBootstrapExecutionByLookupKey,
    agentContextLifecycleCounters: {
      ...input.state.agentContextLifecycleCounters,
    },
    agentContextRotations: input.state.agentContextRotations.map((record) => ({
      ...record,
    })),
    updatedAtMs: persistedAtMs,
    v: LEDGER_STATE_VERSION,
  };
};

const resolveCompactionReferenceNowMs = (input: {
  fallbackNowMs: number;
  state: OpenMeldDaemonLedgerState;
}): number => {
  let maxObservedMs = 0;
  for (const firstSeenAtMs of Object.values(input.state.dedupeFirstSeenByKey)) {
    if (firstSeenAtMs > maxObservedMs) {
      maxObservedMs = firstSeenAtMs;
    }
  }
  for (const inflight of Object.values(input.state.inflightByTaskId)) {
    if (inflight.firstSeenAtMs > maxObservedMs) {
      maxObservedMs = inflight.firstSeenAtMs;
    }
  }
  for (const context of Object.values(input.state.agentContextByLookupKey)) {
    if (context.updatedAtMs > maxObservedMs) {
      maxObservedMs = context.updatedAtMs;
    }
  }
  for (const executionState of Object.values(
    input.state.bootstrapExecutionByLookupKey
  )) {
    const updatedAtMs = Date.parse(executionState.updatedAt);
    if (Number.isFinite(updatedAtMs) && updatedAtMs > maxObservedMs) {
      maxObservedMs = updatedAtMs;
    }
  }
  for (const rotation of input.state.agentContextRotations) {
    if (rotation.rotationAt > maxObservedMs) {
      maxObservedMs = rotation.rotationAt;
    }
  }
  return maxObservedMs > 0 ? maxObservedMs : input.fallbackNowMs;
};

const backupInvalidStateFile = async (input: {
  io: LedgerFileIo;
  paths: LedgerPaths;
}): Promise<void> => {
  const backupPath =
    input.paths.backupStateFilePath ?? `${input.paths.stateFilePath}.bak`;
  try {
    await input.io.copyFile(input.paths.stateFilePath, backupPath);
  } catch {
    throw new Error(LEDGER_STATE_BACKUP_ERROR);
  }
};

const enqueueHistoryWrite = async (input: {
  historyFilePath: string;
  operation: () => Promise<void>;
}): Promise<void> => {
  const previous =
    historyWriteQueueByPath.get(input.historyFilePath) ?? EMPTY_PROMISE;
  const next = previous.catch(() => undefined).then(input.operation);
  historyWriteQueueByPath.set(input.historyFilePath, next);

  try {
    await next;
  } finally {
    if (historyWriteQueueByPath.get(input.historyFilePath) === next) {
      historyWriteQueueByPath.delete(input.historyFilePath);
    }
  }
};

const enqueueLedgerStateWrite = async <T>(input: {
  operation: () => Promise<T>;
  stateFilePath: string;
}): Promise<T> => {
  const previous =
    stateWriteQueueByPath.get(input.stateFilePath) ?? EMPTY_PROMISE;
  const next = previous.catch(() => undefined).then(input.operation);
  const settled = next.then(
    () => undefined,
    () => undefined
  );
  stateWriteQueueByPath.set(input.stateFilePath, settled);

  try {
    return await next;
  } finally {
    if (stateWriteQueueByPath.get(input.stateFilePath) === settled) {
      stateWriteQueueByPath.delete(input.stateFilePath);
    }
  }
};

export const createEmptyLedgerState = (
  nowMs: number = Date.now()
): OpenMeldDaemonLedgerState => ({
  dedupeFirstSeenByKey: {},
  inflightByTaskId: {},
  replayedTaskIds: {},
  agentContextByLookupKey: {},
  bootstrapExecutionByLookupKey: {},
  agentContextLifecycleCounters: createEmptyAgentContextLifecycleCounters(),
  agentContextRotations: [],
  updatedAtMs: nowMs,
  v: LEDGER_STATE_VERSION,
});

export const parseLedgerState = (
  value: unknown
): OpenMeldDaemonLedgerState | null => decodeLedgerState(value);

export const loadLedgerState = async (input: {
  invalidStateStrategy?: LedgerInvalidStateStrategy;
  io: LedgerFileIo;
  paths: LedgerPaths;
}): Promise<OpenMeldDaemonLedgerState> => {
  let rawState = "";
  try {
    rawState = await input.io.readFile(
      input.paths.stateFilePath,
      UTF8_ENCODING
    );
  } catch (error) {
    if (toErrorCode(error) === "ENOENT") {
      return createEmptyLedgerState();
    }
    throw error;
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawState);
  } catch {
    await backupInvalidStateFile(input);
    return handleInvalidLedgerState({
      errorCode: LEDGER_STATE_INVALID_JSON_ERROR,
      invalidStateStrategy: input.invalidStateStrategy,
      io: input.io,
      paths: input.paths,
    });
  }

  const parsedState = parseLedgerState(parsedUnknown);
  if (!parsedState) {
    await backupInvalidStateFile(input);
    return handleInvalidLedgerState({
      errorCode: LEDGER_STATE_SCHEMA_ERROR,
      invalidStateStrategy: input.invalidStateStrategy,
      io: input.io,
      paths: input.paths,
    });
  }

  return parsedState;
};

const handleInvalidLedgerState = async (input: {
  errorCode:
    | typeof LEDGER_STATE_INVALID_JSON_ERROR
    | typeof LEDGER_STATE_SCHEMA_ERROR;
  invalidStateStrategy?: LedgerInvalidStateStrategy;
  io: LedgerFileIo;
  paths: LedgerPaths;
}): Promise<OpenMeldDaemonLedgerState> => {
  if (input.invalidStateStrategy !== "backup_and_reset") {
    throw new Error(input.errorCode);
  }

  const resetAtMs = Date.now();
  const emptyState = createEmptyLedgerState(resetAtMs);
  await persistLedgerStateAtomic({
    io: input.io,
    nowMs: resetAtMs,
    paths: input.paths,
    state: emptyState,
  });
  return emptyState;
};

const buildScopedStateTempFilePath = (input: {
  stateTempFilePath: string;
}): string =>
  `${input.stateTempFilePath}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 10)}`;

const persistLedgerStateAtomic = async (input: {
  io: LedgerFileIo;
  nowMs?: number;
  paths: LedgerPaths;
  state: OpenMeldDaemonLedgerState;
}): Promise<void> => {
  const persistedAtMs = input.nowMs ?? Date.now();
  const normalizedState = compactLedgerState({
    nowMs: persistedAtMs,
    state: cloneLedgerState(input.state),
  });
  await input.io.mkdir(input.paths.rootDirPath, { recursive: true });
  const scopedTempFilePath = buildScopedStateTempFilePath({
    stateTempFilePath: input.paths.stateTempFilePath,
  });
  try {
    await input.io.writeFile(
      scopedTempFilePath,
      serializeLedgerState(normalizedState),
      UTF8_ENCODING
    );
    await input.io.rename(scopedTempFilePath, input.paths.stateFilePath);
  } catch (error) {
    await input.io.rm(scopedTempFilePath, {
      force: true,
    });
    throw error;
  }
};

export const persistLedgerState = async (input: {
  io: LedgerFileIo;
  paths: LedgerPaths;
  state: OpenMeldDaemonLedgerState;
}): Promise<void> =>
  enqueueLedgerStateWrite({
    operation: async () => {
      await persistLedgerStateAtomic(input);
    },
    stateFilePath: input.paths.stateFilePath,
  });

export const withLedgerStateTransaction = async <T>(input: {
  invalidStateStrategy?: LedgerInvalidStateStrategy;
  io: LedgerFileIo;
  mutate: (
    state: OpenMeldDaemonLedgerState
  ) =>
    | LedgerStateTransactionResult<T>
    | Promise<LedgerStateTransactionResult<T>>;
  paths: LedgerPaths;
}): Promise<T> =>
  enqueueLedgerStateWrite({
    operation: async () => {
      const state = await loadLedgerState({
        invalidStateStrategy: input.invalidStateStrategy,
        io: input.io,
        paths: input.paths,
      });
      const { nextState, value } = await input.mutate(state);
      if (nextState !== state) {
        await persistLedgerStateAtomic({
          io: input.io,
          paths: input.paths,
          state: nextState,
        });
      }
      return value;
    },
    stateFilePath: input.paths.stateFilePath,
  });

export const appendLedgerHistoryEntry = async (input: {
  entry: OpenMeldDaemonHistoryEntry;
  io: LedgerFileIo;
  paths: LedgerPaths;
}): Promise<void> => {
  await enqueueHistoryWrite({
    historyFilePath: input.paths.historyFilePath,
    operation: async () => {
      await input.io.mkdir(input.paths.rootDirPath, { recursive: true });
      const nextLine = `${JSON.stringify(input.entry)}\n`;
      const nextLineBytes = utf8ByteLength(nextLine);
      const currentSize = await rotateHistoryIfNeeded({
        io: input.io,
        maxBytes: HISTORY_ROTATION_MAX_BYTES,
        maxArchives: HISTORY_ROTATION_MAX_ARCHIVES,
        nextLineBytes,
        paths: input.paths,
      });
      await input.io.appendFile(
        input.paths.historyFilePath,
        nextLine,
        UTF8_ENCODING
      );
      historySizeByPath.set(
        input.paths.historyFilePath,
        currentSize + nextLineBytes
      );
    },
  });
};

export const resolveDedupeFirstSeenAt = (input: {
  idempotencyKey: string;
  state: OpenMeldDaemonLedgerState;
}): number | undefined =>
  input.state.dedupeFirstSeenByKey[input.idempotencyKey];

export const recordDedupeFirstSeenAt = (input: {
  firstSeenAtMs: number;
  idempotencyKey: string;
  state: OpenMeldDaemonLedgerState;
}): OpenMeldDaemonLedgerState => {
  const current = input.state.dedupeFirstSeenByKey[input.idempotencyKey];
  if (current !== undefined && current <= input.firstSeenAtMs) {
    return input.state;
  }

  const nextState = cloneLedgerState(input.state);
  nextState.dedupeFirstSeenByKey[input.idempotencyKey] = input.firstSeenAtMs;
  nextState.updatedAtMs = Date.now();
  return nextState;
};

export const upsertInflightTask = (input: {
  state: OpenMeldDaemonLedgerState;
  task: OpenMeldDaemonInflightTaskState;
}): OpenMeldDaemonLedgerState => {
  const nextState = cloneLedgerState(input.state);
  nextState.inflightByTaskId[input.task.taskId] = {
    ...input.task,
  };
  nextState.updatedAtMs = Date.now();
  return nextState;
};

export const settleInflightTask = (input: {
  state: OpenMeldDaemonLedgerState;
  taskId: string;
}): OpenMeldDaemonLedgerState => {
  if (!(input.taskId in input.state.inflightByTaskId)) {
    return input.state;
  }
  const nextState = cloneLedgerState(input.state);
  delete nextState.inflightByTaskId[input.taskId];
  nextState.updatedAtMs = Date.now();
  return nextState;
};

export const resolveAgentContextByLookupKey = (input: {
  agentContextLookupKey: string;
  state: OpenMeldDaemonLedgerState;
}): OpenMeldDaemonAgentContextState | undefined =>
  input.state.agentContextByLookupKey[input.agentContextLookupKey];

export const resolveConversationExecutionStateByLookupKey = (input: {
  agentContextLookupKey: string;
  state: OpenMeldDaemonLedgerState;
}): ConversationExecutionState | undefined =>
  input.state.bootstrapExecutionByLookupKey[input.agentContextLookupKey];

export const listAgentContexts = (
  state: OpenMeldDaemonLedgerState
): OpenMeldDaemonAgentContextState[] =>
  Object.values(state.agentContextByLookupKey);

export const upsertAgentContext = (input: {
  agentContext: OpenMeldDaemonAgentContextState;
  state: OpenMeldDaemonLedgerState;
}): OpenMeldDaemonLedgerState => {
  const nextState = cloneLedgerState(input.state);
  nextState.agentContextByLookupKey[input.agentContext.agentContextLookupKey] =
    {
      ...input.agentContext,
    };
  nextState.updatedAtMs = Date.now();
  return nextState;
};

export const removeAgentContext = (input: {
  agentContextLookupKey: string;
  state: OpenMeldDaemonLedgerState;
}): OpenMeldDaemonLedgerState => {
  if (!(input.agentContextLookupKey in input.state.agentContextByLookupKey)) {
    return input.state;
  }
  const nextState = cloneLedgerState(input.state);
  delete nextState.agentContextByLookupKey[input.agentContextLookupKey];
  nextState.updatedAtMs = Date.now();
  return nextState;
};

export const upsertConversationExecutionState = (input: {
  executionState: ConversationExecutionState;
  state: OpenMeldDaemonLedgerState;
}): OpenMeldDaemonLedgerState => {
  const nextState = cloneLedgerState(input.state);
  nextState.bootstrapExecutionByLookupKey[
    input.executionState.agentContextLookupKey
  ] = {
    ...input.executionState,
    ...(input.executionState.lastResolvedAgentControllerConversation
      ? {
          lastResolvedAgentControllerConversation: {
            ...input.executionState.lastResolvedAgentControllerConversation,
          },
        }
      : {}),
  };
  nextState.updatedAtMs = Date.now();
  return nextState;
};

export const removeConversationExecutionState = (input: {
  agentContextLookupKey: string;
  state: OpenMeldDaemonLedgerState;
}): OpenMeldDaemonLedgerState => {
  if (
    !(input.agentContextLookupKey in input.state.bootstrapExecutionByLookupKey)
  ) {
    return input.state;
  }
  const nextState = cloneLedgerState(input.state);
  delete nextState.bootstrapExecutionByLookupKey[input.agentContextLookupKey];
  nextState.updatedAtMs = Date.now();
  return nextState;
};

export const seedLegacyAgentContext = (input: {
  state: OpenMeldDaemonLedgerState;
  agentContextLookupKey: string;
  legacyAgentControllerConversationId: string | null | undefined;
  agentControllerRef: string;
  spaceId: string;
  targetProfileId: string;
  transportMode: RuntimeTransportMode;
  runtimeWorkspaceFingerprint: string;
  taskId: string;
  nowMs: number;
}): OpenMeldDaemonLedgerState => {
  const normalizedLegacyAgentControllerConversationId = normalizeOptionalText(
    input.legacyAgentControllerConversationId
  );
  if (!normalizedLegacyAgentControllerConversationId) {
    return input.state;
  }
  if (input.state.agentContextByLookupKey[input.agentContextLookupKey]) {
    return input.state;
  }
  return upsertAgentContext({
    agentContext: {
      agentControllerConversationId:
        normalizedLegacyAgentControllerConversationId,
      agentControllerRef: resolveStoredAgentControllerRef(
        input.agentControllerRef
      ),
      createdAtMs: input.nowMs,
      lastTaskId: input.taskId,
      agentContextLookupKey: input.agentContextLookupKey,
      runtimeWorkspaceFingerprint: input.runtimeWorkspaceFingerprint,
      spaceId: input.spaceId,
      targetProfileId: input.targetProfileId,
      transportMode: input.transportMode,
      updatedAtMs: input.nowMs,
    },
    state: input.state,
  });
};

export const commitResolvedAgentContext = (input: {
  state: OpenMeldDaemonLedgerState;
  agentContextLookupKey: string;
  agentControllerConversationId: string | null | undefined;
  agentControllerRef: string;
  spaceId: string;
  targetProfileId: string;
  transportMode: RuntimeTransportMode;
  runtimeWorkspaceFingerprint: string;
  taskId: string;
  nowMs: number;
}): OpenMeldDaemonLedgerState => {
  const normalizedAgentControllerConversationId = normalizeOptionalText(
    input.agentControllerConversationId
  );
  if (!normalizedAgentControllerConversationId) {
    return input.state;
  }
  const existing =
    input.state.agentContextByLookupKey[input.agentContextLookupKey] ?? null;
  return upsertAgentContext({
    agentContext: {
      agentControllerConversationId: normalizedAgentControllerConversationId,
      agentControllerRef: resolveStoredAgentControllerRef(
        input.agentControllerRef
      ),
      createdAtMs:
        existing?.agentControllerConversationId ===
        normalizedAgentControllerConversationId
          ? existing.createdAtMs
          : input.nowMs,
      lastTaskId: input.taskId,
      agentContextLookupKey: input.agentContextLookupKey,
      runtimeWorkspaceFingerprint: input.runtimeWorkspaceFingerprint,
      spaceId: input.spaceId,
      targetProfileId: input.targetProfileId,
      transportMode: input.transportMode,
      updatedAtMs: input.nowMs,
    },
    state: input.state,
  });
};

export const bumpAgentContextLifecycleCounters = (input: {
  delta: Partial<OpenMeldDaemonAgentContextLifecycleCounters>;
  state: OpenMeldDaemonLedgerState;
}): OpenMeldDaemonLedgerState => {
  const nextState = cloneLedgerState(input.state);
  for (const [key, delta] of Object.entries(input.delta)) {
    const counterKey = key as keyof OpenMeldDaemonAgentContextLifecycleCounters;
    if (!delta || delta <= 0) {
      continue;
    }
    nextState.agentContextLifecycleCounters[counterKey] += delta;
  }
  nextState.updatedAtMs = Date.now();
  return nextState;
};

export const appendAgentContextRotationRecord = (input: {
  state: OpenMeldDaemonLedgerState;
  record: OpenMeldDaemonAgentContextRotationRecord;
  maxRecords?: number;
}): OpenMeldDaemonLedgerState => {
  const maxRecords = input.maxRecords ?? 200;
  const normalizedMaxRecords =
    Number.isInteger(maxRecords) && maxRecords > 0 ? maxRecords : 200;
  const nextState = cloneLedgerState(input.state);
  nextState.agentContextRotations.push({
    ...input.record,
  });
  if (nextState.agentContextRotations.length > normalizedMaxRecords) {
    nextState.agentContextRotations = nextState.agentContextRotations.slice(
      -normalizedMaxRecords
    );
  }
  nextState.updatedAtMs = Date.now();
  return nextState;
};

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveStoredAgentControllerRef(agentControllerRef: string): string {
  const canonicalAgentControllerRef =
    canonicalizeAgentControllerRef(agentControllerRef);
  if (!canonicalAgentControllerRef) {
    throw new Error(
      `ledger.agent_context.invalid_agent_controller_ref: ${agentControllerRef}`
    );
  }
  return canonicalAgentControllerRef;
}
