import type { HelloAck, SignalEnvelope } from "@openmeld/protocol";
import { buildOpenMeldRequestContextFromProfileIdentity } from "../config/openmeld-request-context";
import { parseIncoming } from "../protocol/wire";
import { createCliSpaceApi, type SpaceSignalsReadQuery } from "./cli-space-api";
import type { SpaceSessionProfileIdentity } from "./session-profile";

const CATCHUP_PAGE_LIMIT = 200;
const CATCHUP_MAX_PAGES = 50;
const RECENT_HISTORY_DEFAULT_LIMIT = 100;
const RECENT_HISTORY_MAX_LIMIT = 500;
const CATCHUP_SEEN_SIGNAL_IDS_MAX = 50_000;
const LAST_SEEN_FUTURE_SKEW_TOLERANCE_MS = 30_000;

type ReplaySignalsInput = {
  seenSignalIds: Set<string>;
  onEvent: (event: SignalEnvelope | HelloAck) => void;
  shouldContinue?: () => boolean;
};

export type SpaceWatchReadState = {
  anchorSignalId: string | null;
  hasReconnected: boolean;
};

export function rememberSpaceWatchAnchor(
  state: SpaceWatchReadState,
  event: SignalEnvelope | HelloAck
): void {
  if (!(isSignalEnvelope(event) && event.type.startsWith("signal."))) {
    return;
  }
  const meta =
    event.data && typeof event.data === "object" && "meta" in event.data
      ? event.data.meta
      : null;
  if (
    meta &&
    typeof meta === "object" &&
    "transient" in meta &&
    meta.transient === true
  ) {
    return;
  }
  state.anchorSignalId = event.id;
}

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
    if (input.shouldContinue?.() === false) {
      return;
    }
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
  shouldContinue?: () => boolean;
}): Promise<string> {
  const afterSignalId = input.afterSignalId.trim();
  if (!afterSignalId) {
    throw new Error("afterSignalId is required for reconnect catch-up");
  }

  let anchor = afterSignalId;
  for (let page = 0; page < CATCHUP_MAX_PAGES; page += 1) {
    if (input.shouldContinue?.() === false) {
      return anchor;
    }
    const signals = await fetchReplaySignals({
      profileIdentity: input.profileIdentity,
      baseUrl: input.baseUrl,
      space: input.space,
      password: input.password,
      query: { afterSignalId: anchor, limit: CATCHUP_PAGE_LIMIT },
    });
    if (input.shouldContinue?.() === false) {
      return anchor;
    }
    if (signals.length === 0) {
      return anchor;
    }
    const last = parseIncoming(signals.at(-1));
    if (
      !last ||
      isServerErrorFrameMessage(last) ||
      !isSignalEnvelope(last) ||
      last.id === anchor
    ) {
      throw new Error("Space catch-up did not advance its message anchor.");
    }
    emitReplaySignals(input, signals);
    anchor = last.id;
    if (signals.length < CATCHUP_PAGE_LIMIT) {
      return anchor;
    }
  }
  throw new Error(
    "Space catch-up exceeded its page budget. Read Space history before starting another watch."
  );
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
