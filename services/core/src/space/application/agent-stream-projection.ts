import {
  AGENT_REPLY_FINAL_PURPOSE,
  agentStreamToolPartSchema,
  isAgentWorkActivityPresentable,
  isLegacyAgentActivityWorkCompatible,
  spaceAgentActivitySchema,
  spaceAgentStreamPresenceSchema,
  spaceAgentStreamSnapshotSchema,
  spaceAgentStreamTerminalSchema,
  spaceMessageDetailsWorkingDetailsSchema,
} from "@openmeld/schemas";
import type {
  AgentStreamToolPart,
  SignalEnvelope,
  SpaceAgentActivity,
  SpaceAgentStreamPresence,
  SpaceAgentStreamSnapshot,
  SpaceAgentStreamTerminal,
  SpaceMessageDetailsWorkingDetails,
} from "@openmeld/schemas/types";

export const AGENT_STREAM_PROJECTION_RETENTION_MS = 30 * 60 * 1000;
export const AGENT_WORKING_DETAILS_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const MAX_RECORDED_AGENT_TOOLS = 50;
const MAX_TRACKED_AGENT_TOOL_CALLS = 500;

const ACTIVE_STREAM_STORAGE_PREFIX = "agent_stream:";
const ACTIVE_STREAM_CURSOR_STORAGE_PREFIX = "agent_stream_cursor:";
const TERMINAL_GUARD_STORAGE_PREFIX = "agent_stream_terminal:";
const WORKING_DETAILS_DRAFT_STORAGE_PREFIX = "agent_stream_working_draft:";
const WORKING_DETAILS_STORAGE_PREFIX = "agent_working_details:";

type AgentStreamDeltaProjection = Omit<
  SpaceAgentStreamSnapshot,
  "createdAtMs" | "expiresAtMs" | "gapDetected" | "state" | "updatedAtMs"
> & { kind?: "text" };

type AgentStreamIdentity = Pick<
  SpaceAgentStreamSnapshot,
  "dispatchId" | "profileId" | "spaceId" | "streamId" | "triggerMessageId" | "v"
>;

type AgentStreamPartProjection = AgentStreamIdentity & {
  part: AgentStreamToolPart;
  sequence: number;
};

type AgentStreamThinkingDeltaProjection = AgentStreamIdentity & {
  sequence: number;
  thinkingSnapshot: string;
};

type AgentStreamCursor = AgentStreamIdentity & {
  sequence: number;
  gapDetected: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
};

type AgentStreamTerminalGuard = {
  v: 1;
  streamId: string;
  lastSequence: number;
  expiresAtMs: number;
};

type StoredAgentToolActivity = {
  toolCallId: string;
  toolName: string;
  state: AgentStreamToolPart["state"];
  startedAtMs: number;
  updatedAtMs: number;
  work?: AgentStreamToolPart["work"];
};

type StoredAgentWorkingDetailsDraft = AgentStreamIdentity & {
  tools: StoredAgentToolActivity[];
  visibleToolCallIds: string[];
  truncated: boolean;
  updatedAtMs: number;
  expiresAtMs: number;
};

type StoredPublishedAgentWorkingDetails = {
  v: 1;
  tools: SpaceMessageDetailsWorkingDetails["tools"];
  truncated: boolean;
  updatedAtMs: number;
  expiresAtMs: number;
};

export type AgentStreamProjectionStorage = {
  delete(key: string | string[]): Promise<boolean | number>;
  get<T>(key: string): Promise<T | undefined>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  transaction<T>(
    closure: (transaction: AgentStreamProjectionStorage) => Promise<T>
  ): Promise<T>;
};

export type AgentStreamProjectionInvalidRecord = {
  errorName: string;
  key: string;
  recordKind:
    | "active_stream"
    | "cursor"
    | "published_working_details"
    | "terminal_guard"
    | "working_details_draft";
};

type AgentStreamProjectionReadOptions = {
  onInvalidRecord?: (record: AgentStreamProjectionInvalidRecord) => void;
};

export type ApplyAgentStreamDeltaResult =
  | {
      status: "accepted";
      snapshot: SpaceAgentStreamSnapshot;
      lastSequence: number;
      gapDetected: boolean;
    }
  | {
      status: "duplicate_accepted";
      lastSequence: number;
    }
  | {
      status: "rejected";
      reasonCode: "agent_stream.identity_mismatch" | "agent_stream.terminal";
      lastSequence: number;
    };

export type ApplyAgentStreamPartResult =
  | {
      status: "accepted";
      lastSequence: number;
      gapDetected: boolean;
      part: AgentStreamToolPart;
    }
  | {
      status: "duplicate_accepted";
      lastSequence: number;
    }
  | {
      status: "rejected";
      reasonCode: "agent_stream.identity_mismatch" | "agent_stream.terminal";
      lastSequence: number;
    };

export type ApplyAgentStreamThinkingDeltaResult =
  | {
      status: "accepted";
      lastSequence: number;
      gapDetected: boolean;
    }
  | {
      status: "duplicate_accepted";
      lastSequence: number;
    }
  | {
      status: "rejected";
      reasonCode: "agent_stream.identity_mismatch" | "agent_stream.terminal";
      lastSequence: number;
    };

export type CloseAgentStreamProjectionResult =
  | {
      status: "closed";
      snapshot: SpaceAgentStreamSnapshot | null;
      stream: AgentStreamIdentity & { sequence: number };
      terminal: SpaceAgentStreamTerminal;
    }
  | {
      status: "already_closed" | "not_found";
      snapshot: null;
      stream: null;
      terminal: SpaceAgentStreamTerminal;
    };

export async function applyAgentStreamDelta(input: {
  storage: AgentStreamProjectionStorage;
  delta: AgentStreamDeltaProjection;
  nowMs: number;
}): Promise<ApplyAgentStreamDeltaResult> {
  const { kind: _kind, ...delta } = input.delta;
  return await input.storage.transaction(async (transaction) => {
    const advanced = await advanceAgentStreamSequence({
      event: delta,
      nowMs: input.nowMs,
      transaction,
    });
    if (advanced.status !== "accepted") {
      return advanced;
    }
    const { currentSnapshot, cursor } = advanced;
    const snapshot = spaceAgentStreamSnapshotSchema.parse({
      ...delta,
      state: "streaming",
      gapDetected: cursor.gapDetected,
      createdAtMs: currentSnapshot?.createdAtMs ?? cursor.createdAtMs,
      updatedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + AGENT_STREAM_PROJECTION_RETENTION_MS,
    });
    await transaction.put(buildActiveStreamKey(delta.streamId), snapshot);

    return {
      status: "accepted",
      snapshot,
      lastSequence: snapshot.sequence,
      gapDetected: cursor.gapDetected,
    };
  });
}

export async function applyAgentStreamThinkingDelta(input: {
  storage: AgentStreamProjectionStorage;
  delta: AgentStreamThinkingDeltaProjection;
  nowMs: number;
}): Promise<ApplyAgentStreamThinkingDeltaResult> {
  return await input.storage.transaction(async (transaction) => {
    const advanced = await advanceAgentStreamSequence({
      event: input.delta,
      nowMs: input.nowMs,
      transaction,
    });
    if (advanced.status !== "accepted") {
      return advanced;
    }
    return {
      status: "accepted",
      lastSequence: advanced.cursor.sequence,
      gapDetected: advanced.cursor.gapDetected,
    };
  });
}

export async function applyAgentStreamPart(input: {
  storage: AgentStreamProjectionStorage;
  part: AgentStreamPartProjection;
  nowMs: number;
}): Promise<ApplyAgentStreamPartResult> {
  const parsedPart = agentStreamToolPartSchema.parse(input.part.part);
  return await input.storage.transaction(async (transaction) => {
    const advanced = await advanceAgentStreamSequence({
      event: input.part,
      nowMs: input.nowMs,
      transaction,
    });
    if (advanced.status !== "accepted") {
      return advanced;
    }
    await recordAgentToolActivity({
      nowMs: input.nowMs,
      part: parsedPart,
      stream: input.part,
      transaction,
    });
    return {
      status: "accepted",
      lastSequence: advanced.cursor.sequence,
      gapDetected: advanced.cursor.gapDetected,
      part: parsedPart,
    };
  });
}

export async function closeAgentStreamProjection(input: {
  storage: AgentStreamProjectionStorage;
  streamId: string;
  terminal: SpaceAgentStreamTerminal;
  nowMs: number;
}): Promise<CloseAgentStreamProjectionResult> {
  const terminal = spaceAgentStreamTerminalSchema.parse(input.terminal);
  return await input.storage.transaction(async (transaction) => {
    const activeKey = buildActiveStreamKey(input.streamId);
    const cursorKey = buildActiveStreamCursorKey(input.streamId);
    const terminalKey = buildTerminalGuardKey(input.streamId);
    const workingDetailsDraftKey = buildWorkingDetailsDraftKey(input.streamId);
    const [storedSnapshot, storedCursor, storedGuard, storedWorkingDetails] =
      await Promise.all([
        transaction.get<unknown>(activeKey),
        transaction.get<unknown>(cursorKey),
        transaction.get<AgentStreamTerminalGuard>(terminalKey),
        transaction.get<unknown>(workingDetailsDraftKey),
      ]);
    const snapshot = storedSnapshot
      ? spaceAgentStreamSnapshotSchema.parse(storedSnapshot)
      : null;
    const cursor = resolveAgentStreamCursor(storedCursor, snapshot);
    const lastSequence = Math.max(
      cursor?.sequence ?? 0,
      snapshot?.sequence ?? 0,
      storedGuard?.lastSequence ?? 0
    );
    const terminalGuard: AgentStreamTerminalGuard = {
      v: 1,
      streamId: input.streamId,
      lastSequence,
      expiresAtMs: input.nowMs + AGENT_STREAM_PROJECTION_RETENTION_MS,
    };
    await transaction.put(terminalKey, terminalGuard);
    if (terminal.kind === "final_message" && storedWorkingDetails) {
      const workingDetails =
        parseStoredAgentWorkingDetailsDraft(storedWorkingDetails);
      const visibleTools = resolveVisibleAgentTools(workingDetails);
      if (visibleTools.length > 0) {
        await transaction.put(
          buildWorkingDetailsKey(terminal.publishedSignalId),
          {
            v: 1,
            tools: visibleTools.map(
              ({ toolName, state, startedAtMs, updatedAtMs, work }) => ({
                toolName,
                state,
                startedAtMs,
                updatedAtMs,
                work,
              })
            ),
            truncated: workingDetails.truncated,
            updatedAtMs: input.nowMs,
            expiresAtMs: input.nowMs + AGENT_WORKING_DETAILS_RETENTION_MS,
          } satisfies StoredPublishedAgentWorkingDetails
        );
      }
    }
    if (storedWorkingDetails) {
      await transaction.delete(workingDetailsDraftKey);
    }
    if (cursor) {
      await transaction.delete([activeKey, cursorKey]);
      return {
        status: "closed",
        snapshot,
        stream: {
          v: cursor.v,
          spaceId: cursor.spaceId,
          streamId: cursor.streamId,
          sequence: cursor.sequence,
          profileId: cursor.profileId,
          triggerMessageId: cursor.triggerMessageId,
          dispatchId: cursor.dispatchId,
        },
        terminal,
      };
    }

    return {
      status:
        storedGuard && storedGuard.expiresAtMs > input.nowMs
          ? "already_closed"
          : "not_found",
      snapshot: null,
      stream: null,
      terminal,
    };
  });
}

export async function readAgentWorkingDetailsForSignal(input: {
  storage: AgentStreamProjectionStorage;
  signalId: string;
  nowMs: number;
}): Promise<SpaceMessageDetailsWorkingDetails | null> {
  const key = buildWorkingDetailsKey(input.signalId);
  const stored = await input.storage.get<unknown>(key);
  if (!stored) {
    return null;
  }
  const workingDetails = parseStoredPublishedAgentWorkingDetails(stored);
  if (workingDetails.expiresAtMs <= input.nowMs) {
    await input.storage.delete(key);
    return null;
  }
  return {
    state: "recorded",
    tools: workingDetails.tools,
    truncated: workingDetails.truncated,
  };
}

export async function readAgentActivityForFinalReply(input: {
  storage: AgentStreamProjectionStorage;
  spaceId: string;
  dispatchId: string;
  profileId: string;
  streamId: string;
  nowMs: number;
}): Promise<SpaceAgentActivity | null> {
  const key = buildWorkingDetailsDraftKey(input.streamId);
  const stored = await input.storage.get<unknown>(key);
  if (!stored) {
    return null;
  }
  const details = parseStoredAgentWorkingDetailsDraft(stored);
  if (details.expiresAtMs <= input.nowMs) {
    await input.storage.delete(key);
    return null;
  }
  if (
    details.streamId !== input.streamId ||
    details.spaceId !== input.spaceId ||
    details.dispatchId !== input.dispatchId ||
    details.profileId !== input.profileId
  ) {
    throw new Error(
      "Agent Activity draft identity does not match the final reply."
    );
  }
  const visibleTools = resolveVisibleAgentTools(details);
  if (visibleTools.length === 0) {
    return null;
  }
  return spaceAgentActivitySchema.parse({
    v: 1,
    steps: visibleTools.map(({ toolName, state, work }) => ({
      toolName,
      state,
      work,
    })),
    truncated: details.truncated,
  });
}

export async function attachAgentActivityToFinalReply(input: {
  agentStreamId?: string;
  storage: AgentStreamProjectionStorage;
  signal: SignalEnvelope;
  nowMs: number;
}): Promise<SignalEnvelope> {
  const { signal } = input;
  if (
    signal.type !== "signal.text" ||
    signal.profile.kind !== "agent" ||
    signal.data.meta?.purpose !== AGENT_REPLY_FINAL_PURPOSE
  ) {
    return signal;
  }

  const dispatchId = signal.data.meta.dispatchId;
  if (!(dispatchId && input.agentStreamId)) {
    return signal;
  }

  const agentActivity = await readAgentActivityForFinalReply({
    storage: input.storage,
    spaceId: signal.spaceId,
    dispatchId,
    profileId: signal.profile.profileId,
    streamId: input.agentStreamId,
    nowMs: input.nowMs,
  });
  if (!agentActivity) {
    return signal;
  }
  const legacyAgentActivity = buildLegacyCompatibleAgentActivity(agentActivity);
  const {
    agentActivity: _existingAgentActivity,
    agentWorkSummary: _existingAgentWorkSummary,
    ...existingMeta
  } = signal.data.meta;
  return {
    ...signal,
    data: {
      ...signal.data,
      meta: {
        ...existingMeta,
        ...(legacyAgentActivity ? { agentActivity: legacyAgentActivity } : {}),
        agentWorkSummary: agentActivity,
      },
    },
  };
}

function buildLegacyCompatibleAgentActivity(
  activity: SpaceAgentActivity
): SpaceAgentActivity | null {
  const steps = activity.steps.filter((step) =>
    isLegacyAgentActivityWorkCompatible(step.work)
  );
  if (steps.length === 0) {
    return null;
  }
  return {
    ...activity,
    steps,
    truncated: activity.truncated || steps.length !== activity.steps.length,
  };
}

export async function listActiveAgentStreamSnapshots(input: {
  storage: AgentStreamProjectionStorage;
  nowMs: number;
  onInvalidRecord?: AgentStreamProjectionReadOptions["onInvalidRecord"];
}): Promise<SpaceAgentStreamSnapshot[]> {
  const stored = await input.storage.list<unknown>({
    prefix: ACTIVE_STREAM_STORAGE_PREFIX,
  });
  const active: SpaceAgentStreamSnapshot[] = [];
  const expiredKeys: string[] = [];
  const invalidRecords: AgentStreamProjectionInvalidRecord[] = [];
  for (const [key, value] of stored) {
    const snapshot = parseStoredProjectionRecord({
      invalidRecords,
      key,
      parse: (storedValue) => spaceAgentStreamSnapshotSchema.parse(storedValue),
      recordKind: "active_stream",
      value,
    });
    if (!snapshot) {
      continue;
    }
    if (snapshot.expiresAtMs <= input.nowMs) {
      expiredKeys.push(key);
    } else {
      active.push(snapshot);
    }
  }
  const deletedKeys = [
    ...expiredKeys,
    ...invalidRecords.map((record) => record.key),
  ];
  if (deletedKeys.length > 0) {
    await input.storage.delete(deletedKeys);
  }
  reportQuarantinedProjectionRecords(invalidRecords, input.onInvalidRecord);

  return active.sort(
    (left, right) =>
      left.createdAtMs - right.createdAtMs ||
      left.streamId.localeCompare(right.streamId)
  );
}

export async function listActiveAgentStreamPresences(input: {
  storage: AgentStreamProjectionStorage;
  nowMs: number;
  onInvalidRecord?: AgentStreamProjectionReadOptions["onInvalidRecord"];
}): Promise<SpaceAgentStreamPresence[]> {
  const stored = await input.storage.list<unknown>({
    prefix: ACTIVE_STREAM_CURSOR_STORAGE_PREFIX,
  });
  const active: SpaceAgentStreamPresence[] = [];
  const expiredKeys: string[] = [];
  const invalidRecords: AgentStreamProjectionInvalidRecord[] = [];
  for (const [key, value] of stored) {
    const cursor = parseStoredProjectionRecord({
      invalidRecords,
      key,
      parse: parseAgentStreamCursor,
      recordKind: "cursor",
      value,
    });
    if (!cursor) {
      continue;
    }
    if (cursor.expiresAtMs <= input.nowMs) {
      expiredKeys.push(key);
      continue;
    }
    active.push(
      spaceAgentStreamPresenceSchema.parse({
        ...cursor,
        state: "streaming",
      })
    );
  }
  const deletedKeys = [
    ...expiredKeys,
    ...invalidRecords.map((record) => record.key),
  ];
  if (deletedKeys.length > 0) {
    await input.storage.delete(deletedKeys);
  }
  reportQuarantinedProjectionRecords(invalidRecords, input.onInvalidRecord);

  return active.sort(
    (left, right) =>
      left.createdAtMs - right.createdAtMs ||
      left.streamId.localeCompare(right.streamId)
  );
}

export async function cleanupExpiredAgentStreamProjections(input: {
  storage: AgentStreamProjectionStorage;
  nowMs: number;
}): Promise<{
  activeDeleted: number;
  terminalGuardsDeleted: number;
  workingDetailsDeleted: number;
}> {
  const [
    active,
    cursors,
    terminalGuards,
    workingDetailsDrafts,
    workingDetails,
  ] = await Promise.all([
    input.storage.list<unknown>({ prefix: ACTIVE_STREAM_STORAGE_PREFIX }),
    input.storage.list<unknown>({
      prefix: ACTIVE_STREAM_CURSOR_STORAGE_PREFIX,
    }),
    input.storage.list<AgentStreamTerminalGuard>({
      prefix: TERMINAL_GUARD_STORAGE_PREFIX,
    }),
    input.storage.list<unknown>({
      prefix: WORKING_DETAILS_DRAFT_STORAGE_PREFIX,
    }),
    input.storage.list<unknown>({ prefix: WORKING_DETAILS_STORAGE_PREFIX }),
  ]);
  const expiredActiveKeys = [...active]
    .filter(([, value]) => {
      const snapshot = spaceAgentStreamSnapshotSchema.parse(value);
      return snapshot.expiresAtMs <= input.nowMs;
    })
    .map(([key]) => key);
  const expiredTerminalGuardKeys = [...terminalGuards]
    .filter(([, value]) => value.expiresAtMs <= input.nowMs)
    .map(([key]) => key);
  const expiredCursorKeys = [...cursors]
    .filter(([, value]) => {
      const cursor = parseAgentStreamCursor(value);
      return cursor.expiresAtMs <= input.nowMs;
    })
    .map(([key]) => key);
  const expiredWorkingDetailsDraftKeys = [...workingDetailsDrafts]
    .filter(([, value]) => {
      const details = parseStoredAgentWorkingDetailsDraft(value);
      return details.expiresAtMs <= input.nowMs;
    })
    .map(([key]) => key);
  const expiredWorkingDetailsKeys = [...workingDetails]
    .filter(([, value]) => {
      const details = parseStoredPublishedAgentWorkingDetails(value);
      return details.expiresAtMs <= input.nowMs;
    })
    .map(([key]) => key);

  const expiredActiveProjectionKeys = [
    ...expiredActiveKeys,
    ...expiredCursorKeys,
    ...expiredWorkingDetailsDraftKeys,
  ];
  const expiredActiveStreamIds = new Set([
    ...expiredActiveKeys.map((key) =>
      key.slice(ACTIVE_STREAM_STORAGE_PREFIX.length)
    ),
    ...expiredCursorKeys.map((key) =>
      key.slice(ACTIVE_STREAM_CURSOR_STORAGE_PREFIX.length)
    ),
    ...expiredWorkingDetailsDraftKeys.map((key) =>
      key.slice(WORKING_DETAILS_DRAFT_STORAGE_PREFIX.length)
    ),
  ]);
  if (expiredActiveProjectionKeys.length > 0) {
    await input.storage.delete(expiredActiveProjectionKeys);
  }
  if (expiredTerminalGuardKeys.length > 0) {
    await input.storage.delete(expiredTerminalGuardKeys);
  }
  if (expiredWorkingDetailsKeys.length > 0) {
    await input.storage.delete(expiredWorkingDetailsKeys);
  }

  return {
    activeDeleted: expiredActiveStreamIds.size,
    terminalGuardsDeleted: expiredTerminalGuardKeys.length,
    workingDetailsDeleted: expiredWorkingDetailsKeys.length,
  };
}

export async function readNextAgentStreamProjectionAlarmAtMs(
  storage: AgentStreamProjectionStorage,
  options: AgentStreamProjectionReadOptions = {}
): Promise<number | null> {
  const [
    active,
    cursors,
    terminalGuards,
    workingDetailsDrafts,
    workingDetails,
  ] = await Promise.all([
    storage.list<unknown>({ prefix: ACTIVE_STREAM_STORAGE_PREFIX }),
    storage.list<unknown>({ prefix: ACTIVE_STREAM_CURSOR_STORAGE_PREFIX }),
    storage.list<AgentStreamTerminalGuard>({
      prefix: TERMINAL_GUARD_STORAGE_PREFIX,
    }),
    storage.list<unknown>({ prefix: WORKING_DETAILS_DRAFT_STORAGE_PREFIX }),
    storage.list<unknown>({ prefix: WORKING_DETAILS_STORAGE_PREFIX }),
  ]);
  const invalidRecords: AgentStreamProjectionInvalidRecord[] = [];
  const validActive = parseStoredProjectionRecordMap({
    invalidRecords,
    parse: (value) => spaceAgentStreamSnapshotSchema.parse(value),
    recordKind: "active_stream",
    records: active,
  });
  const validCursors = parseStoredProjectionRecordMap({
    invalidRecords,
    parse: parseAgentStreamCursor,
    recordKind: "cursor",
    records: cursors,
  });
  const validTerminalGuards = parseStoredProjectionRecordMap({
    invalidRecords,
    parse: parseAgentStreamTerminalGuard,
    recordKind: "terminal_guard",
    records: terminalGuards,
  });
  const validWorkingDetailsDrafts = parseStoredProjectionRecordMap({
    invalidRecords,
    parse: parseStoredAgentWorkingDetailsDraft,
    recordKind: "working_details_draft",
    records: workingDetailsDrafts,
  });
  const validWorkingDetails = parseStoredProjectionRecordMap({
    invalidRecords,
    parse: parseStoredPublishedAgentWorkingDetails,
    recordKind: "published_working_details",
    records: workingDetails,
  });
  if (invalidRecords.length > 0) {
    await storage.delete(invalidRecords.map((record) => record.key));
  }
  reportQuarantinedProjectionRecords(invalidRecords, options.onInvalidRecord);

  let nextAlarmAtMs: number | null = null;
  for (const snapshot of validActive.values()) {
    nextAlarmAtMs = minTimestamp(nextAlarmAtMs, snapshot.expiresAtMs);
  }
  for (const cursor of validCursors.values()) {
    nextAlarmAtMs = minTimestamp(nextAlarmAtMs, cursor.expiresAtMs);
  }
  for (const terminalGuard of validTerminalGuards.values()) {
    nextAlarmAtMs = minTimestamp(nextAlarmAtMs, terminalGuard.expiresAtMs);
  }
  for (const details of validWorkingDetailsDrafts.values()) {
    nextAlarmAtMs = minTimestamp(nextAlarmAtMs, details.expiresAtMs);
  }
  for (const details of validWorkingDetails.values()) {
    nextAlarmAtMs = minTimestamp(nextAlarmAtMs, details.expiresAtMs);
  }
  return nextAlarmAtMs;
}

function parseStoredProjectionRecordMap<T>(input: {
  invalidRecords: AgentStreamProjectionInvalidRecord[];
  parse: (value: unknown) => T;
  recordKind: AgentStreamProjectionInvalidRecord["recordKind"];
  records: Map<string, unknown>;
}): Map<string, T> {
  const parsed = new Map<string, T>();
  for (const [key, value] of input.records) {
    const record = parseStoredProjectionRecord({
      invalidRecords: input.invalidRecords,
      key,
      parse: input.parse,
      recordKind: input.recordKind,
      value,
    });
    if (record) {
      parsed.set(key, record);
    }
  }
  return parsed;
}

function parseStoredProjectionRecord<T>(input: {
  invalidRecords: AgentStreamProjectionInvalidRecord[];
  key: string;
  parse: (value: unknown) => T;
  recordKind: AgentStreamProjectionInvalidRecord["recordKind"];
  value: unknown;
}): T | null {
  try {
    return input.parse(input.value);
  } catch (error) {
    input.invalidRecords.push({
      errorName: error instanceof Error ? error.name : typeof error,
      key: input.key,
      recordKind: input.recordKind,
    });
    return null;
  }
}

function reportQuarantinedProjectionRecords(
  records: readonly AgentStreamProjectionInvalidRecord[],
  onInvalidRecord: AgentStreamProjectionReadOptions["onInvalidRecord"]
): void {
  if (!onInvalidRecord) {
    return;
  }
  for (const record of records) {
    onInvalidRecord(record);
  }
}

function buildActiveStreamKey(streamId: string): string {
  return `${ACTIVE_STREAM_STORAGE_PREFIX}${streamId}`;
}

function buildActiveStreamCursorKey(streamId: string): string {
  return `${ACTIVE_STREAM_CURSOR_STORAGE_PREFIX}${streamId}`;
}

function buildTerminalGuardKey(streamId: string): string {
  return `${TERMINAL_GUARD_STORAGE_PREFIX}${streamId}`;
}

function buildWorkingDetailsDraftKey(streamId: string): string {
  return `${WORKING_DETAILS_DRAFT_STORAGE_PREFIX}${streamId}`;
}

function buildWorkingDetailsKey(signalId: string): string {
  return `${WORKING_DETAILS_STORAGE_PREFIX}${signalId}`;
}

async function recordAgentToolActivity(input: {
  nowMs: number;
  part: AgentStreamToolPart;
  stream: AgentStreamIdentity;
  transaction: AgentStreamProjectionStorage;
}): Promise<void> {
  const key = buildWorkingDetailsDraftKey(input.stream.streamId);
  const stored = await input.transaction.get<unknown>(key);
  const current = stored
    ? parseStoredAgentWorkingDetailsDraft(stored)
    : {
        v: input.stream.v,
        spaceId: input.stream.spaceId,
        streamId: input.stream.streamId,
        profileId: input.stream.profileId,
        triggerMessageId: input.stream.triggerMessageId,
        dispatchId: input.stream.dispatchId,
        tools: [],
        visibleToolCallIds: [],
        truncated: false,
        updatedAtMs: input.nowMs,
        expiresAtMs: input.nowMs + AGENT_STREAM_PROJECTION_RETENTION_MS,
      };
  if (!hasMatchingStreamIdentity(current, input.stream)) {
    throw new Error("Stored Agent working details identity does not match.");
  }

  const existingIndex = current.tools.findIndex(
    (tool) => tool.toolCallId === input.part.toolCallId
  );
  const existing = current.tools[existingIndex];
  if (existing && existing.toolName !== input.part.toolName) {
    throw new Error("Agent tool activity changed toolName for one toolCallId.");
  }
  if (
    existing?.work &&
    input.part.work &&
    !hasSameAgentWork(existing.work, input.part.work)
  ) {
    throw new Error("Agent tool activity changed work for one toolCallId.");
  }
  if (
    existing &&
    !isAllowedAgentToolStateTransition(existing.state, input.part.state)
  ) {
    throw new Error("Agent tool activity has an invalid state transition.");
  }
  const work = input.part.work ?? existing?.work;

  const tool: StoredAgentToolActivity = {
    toolCallId: input.part.toolCallId,
    toolName: input.part.toolName,
    state: input.part.state,
    startedAtMs: existing?.startedAtMs ?? input.nowMs,
    updatedAtMs: input.nowMs,
    ...(work ? { work } : {}),
  };
  const tools = [...current.tools];
  if (existingIndex >= 0) {
    tools[existingIndex] = tool;
  } else {
    reserveAgentToolLifecycleSlot(tools, current.visibleToolCallIds);
    tools.push(tool);
  }
  const visibleToolCallIds = [...current.visibleToolCallIds];
  if (work && !existing?.work && isAgentWorkActivityPresentable(work)) {
    visibleToolCallIds.push(input.part.toolCallId);
  }
  const visibleOverflow = Math.max(
    0,
    visibleToolCallIds.length - MAX_RECORDED_AGENT_TOOLS
  );
  const details: StoredAgentWorkingDetailsDraft = {
    ...current,
    tools,
    visibleToolCallIds:
      visibleOverflow > 0
        ? visibleToolCallIds.slice(visibleOverflow)
        : visibleToolCallIds,
    truncated: current.truncated || visibleOverflow > 0,
    updatedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + AGENT_STREAM_PROJECTION_RETENTION_MS,
  };
  await input.transaction.put(key, details);
}

function reserveAgentToolLifecycleSlot(
  tools: StoredAgentToolActivity[],
  visibleToolCallIds: readonly string[]
): void {
  if (tools.length < MAX_TRACKED_AGENT_TOOL_CALLS) {
    return;
  }
  const visibleIds = new Set(visibleToolCallIds);
  const finalizedEvictionIndex = tools.findIndex(
    (candidate) =>
      candidate.state !== "input-available" &&
      !visibleIds.has(candidate.toolCallId)
  );
  const evictionIndex =
    finalizedEvictionIndex >= 0
      ? finalizedEvictionIndex
      : tools.findIndex((candidate) => !visibleIds.has(candidate.toolCallId));
  if (evictionIndex < 0) {
    throw new Error("Agent tool lifecycle has no evictable internal record.");
  }
  tools.splice(evictionIndex, 1);
}

function hasSameAgentWork(
  left: NonNullable<AgentStreamToolPart["work"]>,
  right: NonNullable<AgentStreamToolPart["work"]>
): boolean {
  return (
    left.v === right.v &&
    left.key === right.key &&
    left.subject?.kind === right.subject?.kind &&
    left.subject?.label === right.subject?.label
  );
}

function isAllowedAgentToolStateTransition(
  current: AgentStreamToolPart["state"],
  next: AgentStreamToolPart["state"]
): boolean {
  return (
    current === next ||
    (current === "input-available" &&
      (next === "output-available" || next === "output-error"))
  );
}

function parseStoredAgentWorkingDetailsDraft(
  value: unknown
): StoredAgentWorkingDetailsDraft {
  if (!(value && typeof value === "object")) {
    throw new Error("Stored Agent working details must be an object.");
  }
  const details = value as Partial<StoredAgentWorkingDetailsDraft>;
  const stringFields = [
    details.spaceId,
    details.streamId,
    details.profileId,
    details.triggerMessageId,
    details.dispatchId,
  ];
  if (
    details.v !== 1 ||
    stringFields.some(
      (field) => typeof field !== "string" || field.trim().length === 0
    ) ||
    !Array.isArray(details.tools) ||
    details.tools.length === 0 ||
    details.tools.length > MAX_TRACKED_AGENT_TOOL_CALLS ||
    typeof details.truncated !== "boolean" ||
    !isNonnegativeInteger(details.updatedAtMs) ||
    !isNonnegativeInteger(details.expiresAtMs) ||
    details.expiresAtMs < details.updatedAtMs
  ) {
    throw new Error("Stored Agent working details are invalid.");
  }

  const tools = details.tools.map((value) => {
    if (!(value && typeof value === "object")) {
      throw new Error("Stored Agent tool activity must be an object.");
    }
    const storedTool = value as Partial<StoredAgentToolActivity>;
    const part = agentStreamToolPartSchema.parse({
      type: "tool",
      toolCallId: storedTool.toolCallId,
      toolName: storedTool.toolName,
      state: storedTool.state,
      ...(storedTool.work ? { work: storedTool.work } : {}),
    });
    if (
      !(
        isNonnegativeInteger(storedTool.startedAtMs) &&
        isNonnegativeInteger(storedTool.updatedAtMs)
      ) ||
      storedTool.updatedAtMs < storedTool.startedAtMs
    ) {
      throw new Error("Stored Agent tool activity timestamps are invalid.");
    }
    return {
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      state: part.state,
      startedAtMs: storedTool.startedAtMs,
      updatedAtMs: storedTool.updatedAtMs,
      ...(part.work ? { work: part.work } : {}),
    };
  });
  const toolIds = new Set(tools.map((tool) => tool.toolCallId));
  if (toolIds.size !== tools.length) {
    throw new Error("Stored Agent tool activity ids must be unique.");
  }
  const visibleToolCallIds =
    details.visibleToolCallIds === undefined
      ? tools
          .filter(
            (tool) =>
              Boolean(tool.work) &&
              isAgentWorkActivityPresentable(
                tool.work as NonNullable<StoredAgentToolActivity["work"]>
              )
          )
          .slice(-MAX_RECORDED_AGENT_TOOLS)
          .map((tool) => tool.toolCallId)
      : details.visibleToolCallIds;
  if (
    !Array.isArray(visibleToolCallIds) ||
    visibleToolCallIds.length > MAX_RECORDED_AGENT_TOOLS ||
    visibleToolCallIds.some(
      (toolCallId) =>
        typeof toolCallId !== "string" ||
        !tools.find(
          (tool) =>
            tool.toolCallId === toolCallId &&
            Boolean(tool.work) &&
            isAgentWorkActivityPresentable(
              tool.work as NonNullable<StoredAgentToolActivity["work"]>
            )
        )
    ) ||
    new Set(visibleToolCallIds).size !== visibleToolCallIds.length
  ) {
    throw new Error("Stored visible Agent tool activity ids are invalid.");
  }

  return {
    v: 1,
    spaceId: details.spaceId as string,
    streamId: details.streamId as string,
    profileId: details.profileId as string,
    triggerMessageId: details.triggerMessageId as string,
    dispatchId: details.dispatchId as string,
    tools,
    visibleToolCallIds,
    truncated: details.truncated,
    updatedAtMs: details.updatedAtMs,
    expiresAtMs: details.expiresAtMs,
  };
}

function resolveVisibleAgentTools(
  details: StoredAgentWorkingDetailsDraft
): Array<
  StoredAgentToolActivity & Required<Pick<StoredAgentToolActivity, "work">>
> {
  const toolsById = new Map(
    details.tools.map((tool) => [tool.toolCallId, tool] as const)
  );
  return details.visibleToolCallIds.map((toolCallId) => {
    const tool = toolsById.get(toolCallId);
    if (!tool?.work) {
      throw new Error("Stored visible Agent tool activity is missing work.");
    }
    return {
      ...tool,
      work: tool.work,
    };
  });
}

function parseStoredPublishedAgentWorkingDetails(
  value: unknown
): StoredPublishedAgentWorkingDetails {
  if (!(value && typeof value === "object")) {
    throw new Error(
      "Stored published Agent working details must be an object."
    );
  }
  const details = value as Partial<StoredPublishedAgentWorkingDetails>;
  if (
    details.v !== 1 ||
    !isNonnegativeInteger(details.updatedAtMs) ||
    !isNonnegativeInteger(details.expiresAtMs) ||
    details.expiresAtMs < details.updatedAtMs
  ) {
    throw new Error("Stored published Agent working details are invalid.");
  }
  const parsed = spaceMessageDetailsWorkingDetailsSchema.parse({
    state: "recorded",
    tools: details.tools,
    truncated: details.truncated,
  });
  return {
    v: 1,
    tools: parsed.tools,
    truncated: parsed.truncated,
    updatedAtMs: details.updatedAtMs,
    expiresAtMs: details.expiresAtMs,
  };
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasMatchingStreamIdentity(
  current: AgentStreamIdentity,
  next: AgentStreamIdentity
): boolean {
  return (
    current.spaceId === next.spaceId &&
    current.streamId === next.streamId &&
    current.profileId === next.profileId &&
    current.triggerMessageId === next.triggerMessageId &&
    current.dispatchId === next.dispatchId
  );
}

type AdvanceAgentStreamSequenceResult =
  | {
      status: "accepted";
      cursor: AgentStreamCursor;
      currentSnapshot: SpaceAgentStreamSnapshot | null;
    }
  | {
      status: "duplicate_accepted";
      lastSequence: number;
    }
  | {
      status: "rejected";
      reasonCode: "agent_stream.identity_mismatch" | "agent_stream.terminal";
      lastSequence: number;
    };

async function advanceAgentStreamSequence(input: {
  transaction: AgentStreamProjectionStorage;
  event: AgentStreamIdentity & { sequence: number };
  nowMs: number;
}): Promise<AdvanceAgentStreamSequenceResult> {
  const terminalKey = buildTerminalGuardKey(input.event.streamId);
  const terminalGuard =
    await input.transaction.get<AgentStreamTerminalGuard>(terminalKey);
  if (terminalGuard && terminalGuard.expiresAtMs > input.nowMs) {
    return {
      status: "rejected",
      reasonCode: "agent_stream.terminal",
      lastSequence: terminalGuard.lastSequence,
    };
  }
  if (terminalGuard) {
    await input.transaction.delete(terminalKey);
  }

  const activeKey = buildActiveStreamKey(input.event.streamId);
  const cursorKey = buildActiveStreamCursorKey(input.event.streamId);
  const [storedSnapshot, storedCursor] = await Promise.all([
    input.transaction.get<unknown>(activeKey),
    input.transaction.get<unknown>(cursorKey),
  ]);
  const currentSnapshot = storedSnapshot
    ? spaceAgentStreamSnapshotSchema.parse(storedSnapshot)
    : null;
  const currentCursor = resolveAgentStreamCursor(storedCursor, currentSnapshot);
  if (
    (currentSnapshot &&
      !hasMatchingStreamIdentity(currentSnapshot, input.event)) ||
    (currentCursor && !hasMatchingStreamIdentity(currentCursor, input.event))
  ) {
    return {
      status: "rejected",
      reasonCode: "agent_stream.identity_mismatch",
      lastSequence: Math.max(
        currentSnapshot?.sequence ?? 0,
        currentCursor?.sequence ?? 0
      ),
    };
  }
  if (currentCursor && input.event.sequence <= currentCursor.sequence) {
    return {
      status: "duplicate_accepted",
      lastSequence: currentCursor.sequence,
    };
  }

  const cursor: AgentStreamCursor = {
    v: input.event.v,
    spaceId: input.event.spaceId,
    streamId: input.event.streamId,
    profileId: input.event.profileId,
    triggerMessageId: input.event.triggerMessageId,
    dispatchId: input.event.dispatchId,
    sequence: input.event.sequence,
    gapDetected:
      (currentCursor?.gapDetected ?? false) ||
      input.event.sequence > (currentCursor?.sequence ?? 0) + 1,
    createdAtMs: currentCursor?.createdAtMs ?? input.nowMs,
    updatedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + AGENT_STREAM_PROJECTION_RETENTION_MS,
  };
  await input.transaction.put(cursorKey, cursor);
  return { status: "accepted", cursor, currentSnapshot };
}

function createCursorFromSnapshot(
  snapshot: SpaceAgentStreamSnapshot
): AgentStreamCursor {
  return {
    v: snapshot.v,
    spaceId: snapshot.spaceId,
    streamId: snapshot.streamId,
    profileId: snapshot.profileId,
    triggerMessageId: snapshot.triggerMessageId,
    dispatchId: snapshot.dispatchId,
    sequence: snapshot.sequence,
    gapDetected: snapshot.gapDetected,
    createdAtMs: snapshot.createdAtMs,
    updatedAtMs: snapshot.updatedAtMs,
    expiresAtMs: snapshot.expiresAtMs,
  };
}

function resolveAgentStreamCursor(
  storedCursor: unknown,
  snapshot: SpaceAgentStreamSnapshot | null
): AgentStreamCursor | null {
  if (storedCursor !== undefined) {
    return parseAgentStreamCursor(storedCursor);
  }
  return snapshot ? createCursorFromSnapshot(snapshot) : null;
}

function parseAgentStreamCursor(value: unknown): AgentStreamCursor {
  if (!(value && typeof value === "object")) {
    throw new Error("Stored Agent stream cursor must be an object.");
  }
  const cursor = value as Partial<AgentStreamCursor>;
  const stringFields = [
    cursor.spaceId,
    cursor.streamId,
    cursor.profileId,
    cursor.triggerMessageId,
    cursor.dispatchId,
  ];
  const timestampFields = [
    cursor.createdAtMs,
    cursor.updatedAtMs,
    cursor.expiresAtMs,
  ];
  if (
    cursor.v !== 1 ||
    stringFields.some(
      (field) => typeof field !== "string" || field.trim().length === 0
    ) ||
    !(
      typeof cursor.sequence === "number" &&
      Number.isInteger(cursor.sequence) &&
      cursor.sequence > 0
    ) ||
    typeof cursor.gapDetected !== "boolean" ||
    timestampFields.some(
      (field) =>
        typeof field !== "number" || !Number.isInteger(field) || field < 0
    )
  ) {
    throw new Error("Stored Agent stream cursor is invalid.");
  }
  return cursor as AgentStreamCursor;
}

function parseAgentStreamTerminalGuard(
  value: unknown
): AgentStreamTerminalGuard {
  if (!(value && typeof value === "object")) {
    throw new Error("Stored Agent stream terminal guard must be an object.");
  }
  const guard = value as Partial<AgentStreamTerminalGuard>;
  if (
    guard.v !== 1 ||
    typeof guard.streamId !== "string" ||
    guard.streamId.trim().length === 0 ||
    !isNonnegativeInteger(guard.lastSequence) ||
    !isNonnegativeInteger(guard.expiresAtMs)
  ) {
    throw new Error("Stored Agent stream terminal guard is invalid.");
  }
  return guard as AgentStreamTerminalGuard;
}

function minTimestamp(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.min(current, candidate);
}
