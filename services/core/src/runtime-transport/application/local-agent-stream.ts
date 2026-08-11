import { spaceAgentStreamTerminalSchema } from "@openmeld/schemas";
import type {
  RuntimeCoordinatorFinalizationCommand,
  RuntimeCoordinatorFinalizationOutcome,
  SpaceAgentStreamTerminal,
} from "@openmeld/schemas/types";
import { resolvePublicAgentFailureReason } from "@openmeld/space-mesh";

const LOCAL_AGENT_STREAM_CLOSURE_RETRY_ENTRY_STORAGE_PREFIX =
  "runtime-coordinator:local-agent-stream-closure-retry:entry:";
const LOCAL_AGENT_STREAM_CLOSURE_RETRY_DUE_STORAGE_PREFIX =
  "runtime-coordinator:local-agent-stream-closure-retry:due:";
const LOCAL_AGENT_STREAM_CLOSURE_RETRY_TIMESTAMP_WIDTH = 16;
const LOCAL_AGENT_STREAM_CLOSURE_RETRY_BASE_DELAY_MS = 5000;
const LOCAL_AGENT_STREAM_CLOSURE_RETRY_MAX_DELAY_MS = 5 * 60_000;

export type LocalAgentStreamClosureRetryEntry = {
  attemptCount: number;
  attemptId: string;
  createdAtMs: number;
  dispatchId: string;
  nextRetryAtMs: number;
  runtimeCoordinatorExecutionId: string;
  spaceId: string;
  streamId: string;
  terminal: SpaceAgentStreamTerminal;
  updatedAtMs: number;
  v: 1;
};

type LocalAgentStreamClosureRetryReader = Pick<
  DurableObjectStorage,
  "get" | "list"
>;

type LocalAgentStreamClosureRetryStorage = Pick<
  DurableObjectStorage,
  "delete" | "get" | "list" | "put" | "transaction"
>;

type LocalAgentStreamClosureRetryDueMarker = {
  streamId: string;
  v: 1;
};

export function buildLocalAgentStreamId(input: {
  attemptId: string;
  dispatchId: string;
}): string {
  return [
    "local-agent",
    encodeLengthPrefixedPart(input.dispatchId),
    encodeLengthPrefixedPart(input.attemptId),
  ].join(":");
}

export function buildLocalAgentStreamTerminal(input: {
  command: RuntimeCoordinatorFinalizationCommand;
  outcome: RuntimeCoordinatorFinalizationOutcome;
}): SpaceAgentStreamTerminal {
  const resultPayload = input.command.acceptedResult.taskResult.payload;
  const resultStatus = resultPayload.status;
  if (
    input.outcome.ok &&
    input.outcome.publishState === "reply_published" &&
    input.outcome.publishedSignalId &&
    (resultStatus === "success" || resultStatus === "partial_success")
  ) {
    return {
      kind: "final_message",
      publishedSignalId: input.outcome.publishedSignalId,
    };
  }

  if (input.outcome.publishState === "invalid_space_action") {
    return {
      kind: "failed",
      noticeText:
        "The Agent finished, but did not produce a valid Space reply.",
      reasonCode: "daemon.result.invalid_space_action",
    };
  }
  if (input.outcome.publishState === "reply_publication_failed") {
    return {
      kind: "failed",
      noticeText: "The Agent finished, but its reply could not be posted.",
      reasonCode:
        input.outcome.publicationErrorCode ??
        "daemon.result.finalization_unavailable",
    };
  }
  if (resultPayload.status === "failed") {
    return {
      kind: "failed",
      noticeText:
        resolvePublicAgentFailureReason({
          defaultReason: "The Agent could not finish this response.",
          errorCode: resultPayload.errorCode,
          errorMessage: resultPayload.errorMessage,
          targetLabel: input.command.targetProfileName,
        }) ?? "The Agent could not finish this response.",
      reasonCode: resultPayload.errorCode ?? "daemon.result.task_failed",
    };
  }
  return {
    kind: "failed",
    noticeText: "The Agent could not finish this response.",
    reasonCode: "daemon.result.task_failed",
  };
}

export function buildStoppedLocalAgentStreamTerminal(
  reasonCode: string
): SpaceAgentStreamTerminal {
  return {
    kind: "stopped",
    noticeText: "The Agent stopped this reply.",
    reasonCode,
  };
}

export function buildFailedLocalAgentStreamTerminal(
  reasonCode: string
): SpaceAgentStreamTerminal {
  return {
    kind: "failed",
    noticeText: "The Agent finished, but its reply could not be posted.",
    reasonCode,
  };
}

export function createLocalAgentStreamClosureRetryEntry(input: {
  attemptId: string;
  dispatchId: string;
  nowMs: number;
  runtimeCoordinatorExecutionId: string;
  spaceId: string;
  terminal: SpaceAgentStreamTerminal;
}): LocalAgentStreamClosureRetryEntry {
  return {
    attemptCount: 1,
    attemptId: input.attemptId,
    createdAtMs: input.nowMs,
    dispatchId: input.dispatchId,
    nextRetryAtMs: input.nowMs + LOCAL_AGENT_STREAM_CLOSURE_RETRY_BASE_DELAY_MS,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    spaceId: input.spaceId,
    streamId: buildLocalAgentStreamId(input),
    terminal: spaceAgentStreamTerminalSchema.parse(input.terminal),
    updatedAtMs: input.nowMs,
    v: 1,
  };
}

export function incrementLocalAgentStreamClosureRetryEntry(input: {
  entry: LocalAgentStreamClosureRetryEntry;
  nowMs: number;
}): LocalAgentStreamClosureRetryEntry {
  const attemptCount = input.entry.attemptCount + 1;
  const delayMs = Math.min(
    LOCAL_AGENT_STREAM_CLOSURE_RETRY_BASE_DELAY_MS *
      2 ** Math.min(attemptCount - 1, 6),
    LOCAL_AGENT_STREAM_CLOSURE_RETRY_MAX_DELAY_MS
  );
  return {
    ...input.entry,
    attemptCount,
    nextRetryAtMs: input.nowMs + delayMs,
    updatedAtMs: input.nowMs,
  };
}

export async function readLocalAgentStreamClosureRetryEntry(input: {
  storage: LocalAgentStreamClosureRetryReader;
  streamId: string;
}): Promise<LocalAgentStreamClosureRetryEntry | null> {
  const entryKey = buildLocalAgentStreamClosureRetryEntryStorageKey(
    input.streamId
  );
  const raw = await input.storage.get<unknown>(entryKey);
  if (raw === undefined) {
    return null;
  }
  return requireLocalAgentStreamClosureRetryEntry(raw, entryKey);
}

export async function listDueLocalAgentStreamClosureRetryEntries(input: {
  limit: number;
  nowMs: number;
  storage: LocalAgentStreamClosureRetryReader;
}): Promise<LocalAgentStreamClosureRetryEntry[]> {
  if (!(Number.isInteger(input.limit) && input.limit > 0)) {
    throw new Error("local_agent_stream_closure_retry_limit_invalid");
  }
  const stored = await input.storage.list<unknown>({
    limit: input.limit,
    prefix: LOCAL_AGENT_STREAM_CLOSURE_RETRY_DUE_STORAGE_PREFIX,
  });
  const dueEntries: LocalAgentStreamClosureRetryEntry[] = [];
  for (const [dueKey, rawMarker] of stored) {
    const marker = requireLocalAgentStreamClosureRetryDueMarker(
      dueKey,
      rawMarker
    );
    if (marker.nextRetryAtMs > input.nowMs) {
      break;
    }
    const entry = await readLocalAgentStreamClosureRetryEntry({
      storage: input.storage,
      streamId: marker.streamId,
    });
    if (!entry) {
      throw new Error(
        `local_agent_stream_closure_retry_entry_missing:${marker.streamId}`
      );
    }
    if (
      entry.nextRetryAtMs !== marker.nextRetryAtMs ||
      dueKey !== buildLocalAgentStreamClosureRetryDueStorageKey(entry)
    ) {
      throw new Error(
        `local_agent_stream_closure_retry_due_entry_mismatch:${marker.streamId}`
      );
    }
    dueEntries.push(entry);
  }
  return dueEntries;
}

export async function upsertLocalAgentStreamClosureRetryEntry(input: {
  entry: LocalAgentStreamClosureRetryEntry;
  storage: LocalAgentStreamClosureRetryStorage;
}): Promise<void> {
  await input.storage.transaction(async (transaction) => {
    const entry = requireLocalAgentStreamClosureRetryEntry(
      input.entry,
      buildLocalAgentStreamClosureRetryEntryStorageKey(input.entry.streamId)
    );
    const existing = await readLocalAgentStreamClosureRetryEntry({
      storage: transaction,
      streamId: entry.streamId,
    });
    if (existing) {
      await transaction.delete(
        buildLocalAgentStreamClosureRetryDueStorageKey(existing)
      );
    }
    await transaction.put(
      buildLocalAgentStreamClosureRetryEntryStorageKey(entry.streamId),
      entry
    );
    await transaction.put(
      buildLocalAgentStreamClosureRetryDueStorageKey(entry),
      {
        streamId: entry.streamId,
        v: 1,
      } satisfies LocalAgentStreamClosureRetryDueMarker
    );
  });
}

export async function removeLocalAgentStreamClosureRetryEntry(input: {
  storage: LocalAgentStreamClosureRetryStorage;
  streamId: string;
}): Promise<void> {
  await input.storage.transaction(async (transaction) => {
    const entry = await readLocalAgentStreamClosureRetryEntry({
      storage: transaction,
      streamId: input.streamId,
    });
    if (!entry) {
      return;
    }
    await transaction.delete(
      buildLocalAgentStreamClosureRetryDueStorageKey(entry)
    );
    await transaction.delete(
      buildLocalAgentStreamClosureRetryEntryStorageKey(entry.streamId)
    );
  });
}

export async function readNextLocalAgentStreamClosureRetryAtMs(
  storage: LocalAgentStreamClosureRetryReader
): Promise<number | null> {
  const entries = await listDueLocalAgentStreamClosureRetryEntries({
    limit: 1,
    nowMs: Number.MAX_SAFE_INTEGER,
    storage,
  });
  return entries[0]?.nextRetryAtMs ?? null;
}

function buildLocalAgentStreamClosureRetryEntryStorageKey(
  streamId: string
): string {
  return `${LOCAL_AGENT_STREAM_CLOSURE_RETRY_ENTRY_STORAGE_PREFIX}${streamId}`;
}

function buildLocalAgentStreamClosureRetryDueStorageKey(
  entry: Pick<LocalAgentStreamClosureRetryEntry, "nextRetryAtMs" | "streamId">
): string {
  const timestamp = String(entry.nextRetryAtMs).padStart(
    LOCAL_AGENT_STREAM_CLOSURE_RETRY_TIMESTAMP_WIDTH,
    "0"
  );
  return `${LOCAL_AGENT_STREAM_CLOSURE_RETRY_DUE_STORAGE_PREFIX}${timestamp}:${entry.streamId}`;
}

function requireLocalAgentStreamClosureRetryDueMarker(
  dueKey: string,
  value: unknown
): LocalAgentStreamClosureRetryDueMarker & { nextRetryAtMs: number } {
  if (!(value && typeof value === "object")) {
    throw new Error(
      `local_agent_stream_closure_retry_due_marker_invalid:${dueKey}`
    );
  }
  const marker = value as Partial<LocalAgentStreamClosureRetryDueMarker>;
  const timestampStart =
    LOCAL_AGENT_STREAM_CLOSURE_RETRY_DUE_STORAGE_PREFIX.length;
  const timestampEnd =
    timestampStart + LOCAL_AGENT_STREAM_CLOSURE_RETRY_TIMESTAMP_WIDTH;
  const timestampText = dueKey.slice(timestampStart, timestampEnd);
  const nextRetryAtMs = Number(timestampText);
  if (
    marker.v !== 1 ||
    !isNonEmptyString(marker.streamId) ||
    dueKey.charAt(timestampEnd) !== ":" ||
    !isNonNegativeInteger(nextRetryAtMs) ||
    dueKey !==
      buildLocalAgentStreamClosureRetryDueStorageKey({
        nextRetryAtMs,
        streamId: marker.streamId,
      })
  ) {
    throw new Error(
      `local_agent_stream_closure_retry_due_marker_invalid:${dueKey}`
    );
  }
  return {
    nextRetryAtMs,
    streamId: marker.streamId,
    v: 1,
  };
}

function requireLocalAgentStreamClosureRetryEntry(
  value: unknown,
  storageKey: string
): LocalAgentStreamClosureRetryEntry {
  const entry = normalizeLocalAgentStreamClosureRetryEntry(value);
  if (!entry) {
    throw new Error(
      `local_agent_stream_closure_retry_entry_invalid:${storageKey}`
    );
  }
  return entry;
}

function normalizeLocalAgentStreamClosureRetryEntry(
  value: unknown
): LocalAgentStreamClosureRetryEntry | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const candidate = value as Partial<LocalAgentStreamClosureRetryEntry>;
  const terminal = spaceAgentStreamTerminalSchema.safeParse(candidate.terminal);
  if (
    candidate.v !== 1 ||
    !terminal.success ||
    !isNonEmptyString(candidate.attemptId) ||
    !isNonEmptyString(candidate.dispatchId) ||
    !isNonEmptyString(candidate.runtimeCoordinatorExecutionId) ||
    !isNonEmptyString(candidate.spaceId) ||
    !isNonEmptyString(candidate.streamId) ||
    !isNonNegativeInteger(candidate.attemptCount) ||
    candidate.attemptCount < 1 ||
    !isNonNegativeInteger(candidate.createdAtMs) ||
    !isNonNegativeInteger(candidate.nextRetryAtMs) ||
    !isNonNegativeInteger(candidate.updatedAtMs)
  ) {
    return null;
  }
  const streamId = buildLocalAgentStreamId({
    attemptId: candidate.attemptId,
    dispatchId: candidate.dispatchId,
  });
  if (candidate.streamId !== streamId) {
    return null;
  }
  return {
    attemptCount: candidate.attemptCount,
    attemptId: candidate.attemptId,
    createdAtMs: candidate.createdAtMs,
    dispatchId: candidate.dispatchId,
    nextRetryAtMs: candidate.nextRetryAtMs,
    runtimeCoordinatorExecutionId: candidate.runtimeCoordinatorExecutionId,
    spaceId: candidate.spaceId,
    streamId,
    terminal: terminal.data,
    updatedAtMs: candidate.updatedAtMs,
    v: 1,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function encodeLengthPrefixedPart(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("local_agent.stream_id_part_empty");
  }
  return `${normalized.length}.${normalized}`;
}
