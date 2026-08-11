import type { HelloAck, SignalEnvelope } from "@openmeld/protocol";
import { buildOpenMeldRequestContextFromProfileIdentity } from "../config/openmeld-request-context";
import { parseIncoming } from "../protocol/wire";
import { createCliSpaceApi, type SpaceSignalsReadQuery } from "./cli-space-api";
import type { SpaceSessionProfileIdentity } from "./session-profile";

const CATCHUP_PAGE_LIMIT = 200;
const RECENT_HISTORY_DEFAULT_LIMIT = 100;
const RECENT_HISTORY_MAX_LIMIT = 500;
const CATCHUP_SEEN_SIGNAL_IDS_MAX = 50_000;
const LAST_SEEN_FUTURE_SKEW_TOLERANCE_MS = 30_000;

type ReplaySignalsInput = {
  seenSignalIds: Set<string>;
  onEvent: (event: SignalEnvelope | HelloAck) => void;
};

type ShouldIgnoreIncomingSignalReason =
  | "seen_replay_duplicate"
  | "older_than_live_floor"
  | null;

type ShouldIgnoreIncomingSignalResult = {
  ignore: boolean;
  reason: ShouldIgnoreIncomingSignalReason;
};

export function rememberSeenSignalId(
  seenSignalIds: Set<string>,
  signalId: string
): void {
  if (seenSignalIds.has(signalId)) {
    return;
  }

  seenSignalIds.add(signalId);
  while (seenSignalIds.size > CATCHUP_SEEN_SIGNAL_IDS_MAX) {
    const oldestSignalId = seenSignalIds.values().next().value;
    if (typeof oldestSignalId !== "string") {
      return;
    }
    seenSignalIds.delete(oldestSignalId);
  }
}

function emitReplaySignals(
  input: ReplaySignalsInput,
  signals: readonly unknown[]
): void {
  for (const item of signals) {
    const event = parseIncoming(item);
    if (!event || isServerErrorFrameMessage(event)) {
      continue;
    }
    if (!isSignalEnvelope(event)) {
      input.onEvent(event);
      continue;
    }
    if (input.seenSignalIds.has(event.id)) {
      continue;
    }
    input.onEvent(event);
    rememberSeenSignalId(input.seenSignalIds, event.id);
  }
}

function isSignalEnvelope(
  event: SignalEnvelope | HelloAck
): event is SignalEnvelope {
  return "id" in event && typeof event.id === "string";
}

function isServerErrorFrameMessage(
  event: SignalEnvelope | HelloAck | { error: string }
): event is { error: string; requestId?: string; clientMessageId?: string } {
  return typeof (event as { error?: unknown }).error === "string";
}

async function fetchReplaySignals(input: {
  profileIdentity: SpaceSessionProfileIdentity;
  baseUrl: string;
  space: string;
  password?: string;
  query: SpaceSignalsReadQuery;
}): Promise<readonly unknown[]> {
  const response = await createCliSpaceApi(input.baseUrl).listSignals({
    spaceId: input.space,
    requestContext: buildOpenMeldRequestContextFromProfileIdentity({
      profileIdentity: input.profileIdentity,
    }),
    query: input.query,
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
  });
  return response.signals;
}

export async function replayMissedSignals(input: {
  profileIdentity: SpaceSessionProfileIdentity;
  baseUrl: string;
  space: string;
  password?: string;
  afterSignalId: string;
  seenSignalIds: Set<string>;
  onEvent: (event: SignalEnvelope | HelloAck) => void;
}): Promise<void> {
  const afterSignalId = input.afterSignalId.trim();
  if (!afterSignalId) {
    throw new Error("afterSignalId is required for reconnect catch-up");
  }

  // Known pagination gap: Core's GET /v1/spaces/:id/signals afterSignalId
  // branch always returns nextCursor: null. This helper requests
  // CATCHUP_PAGE_LIMIT (200) signals, while the shared query schema caps any
  // caller at 500, so a larger gap is silently truncated. This helper has no
  // production caller while the CLI Space connect flow has no automatic
  // reconnect loop. Before wiring it into one, drain full pages by advancing
  // afterSignalId, following Web's
  // drainSpaceUpdatesFromAnchor/readSpaceUpdates pattern, or add true
  // pagination to Core's anchor branch.
  const signals = await fetchReplaySignals({
    profileIdentity: input.profileIdentity,
    baseUrl: input.baseUrl,
    space: input.space,
    password: input.password,
    query: {
      afterSignalId,
      limit: CATCHUP_PAGE_LIMIT,
    },
  });
  emitReplaySignals(input, signals);
}

export async function replayRecentSignals(input: {
  profileIdentity: SpaceSessionProfileIdentity;
  baseUrl: string;
  space: string;
  password?: string;
  limit: number;
  seenSignalIds: Set<string>;
  onEvent: (event: SignalEnvelope | HelloAck) => void;
}): Promise<void> {
  if (input.limit <= 0) {
    return;
  }

  const signals = await fetchReplaySignals({
    profileIdentity: input.profileIdentity,
    baseUrl: input.baseUrl,
    space: input.space,
    password: input.password,
    query: {
      limit: Math.max(1, Math.min(input.limit, RECENT_HISTORY_MAX_LIMIT)),
      recent: true,
    },
  });
  emitReplaySignals(input, signals);
}

export function normalizeRecentHistoryLimit(value: number | undefined): number {
  if (value === undefined) {
    return RECENT_HISTORY_DEFAULT_LIMIT;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("history limit must be a non-negative integer");
  }
  return Math.min(value, RECENT_HISTORY_MAX_LIMIT);
}

export function resolveInitialLiveFloorTs(input: {
  lastSeenTs: number | null;
  nowMs: number;
}): number {
  if (
    typeof input.lastSeenTs !== "number" ||
    !Number.isFinite(input.lastSeenTs)
  ) {
    return 0;
  }

  const normalizedLastSeenTs = Math.max(0, Math.trunc(input.lastSeenTs));
  const maxAllowedFloorTs = input.nowMs + LAST_SEEN_FUTURE_SKEW_TOLERANCE_MS;

  if (normalizedLastSeenTs > maxAllowedFloorTs) {
    return input.nowMs;
  }

  return normalizedLastSeenTs;
}

export function shouldIgnoreIncomingSignal(input: {
  event: SignalEnvelope | HelloAck;
  liveFloorTs: number;
  seenSignalIds: Set<string>;
  selfProfileId?: string;
}): ShouldIgnoreIncomingSignalResult {
  const { event, liveFloorTs, seenSignalIds } = input;
  if (!isSignalEnvelope(event)) {
    return { ignore: false, reason: null };
  }

  if (seenSignalIds.has(event.id)) {
    return { ignore: true, reason: "seen_replay_duplicate" };
  }

  const selfProfileId = String(input.selfProfileId ?? "").trim();
  const senderProfileId = String(event.profile?.profileId ?? "").trim();
  if (selfProfileId && senderProfileId === selfProfileId) {
    return { ignore: false, reason: null };
  }

  if (event.ts < liveFloorTs) {
    return { ignore: true, reason: "older_than_live_floor" };
  }

  return { ignore: false, reason: null };
}

export function processIgnoredOlderThanLiveFloorSignal(input: {
  event: SignalEnvelope | HelloAck;
  seenSignalIds: Set<string>;
  onDispatchActivityEvent: (event: SignalEnvelope) => void;
}): boolean {
  if (!isSignalEnvelope(input.event)) {
    return false;
  }
  rememberSeenSignalId(input.seenSignalIds, input.event.id);
  input.onDispatchActivityEvent(input.event);
  return true;
}
