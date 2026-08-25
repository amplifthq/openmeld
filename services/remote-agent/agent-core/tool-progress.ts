import type { RemoteAgentStorage } from "./callback-context";
import { digestCanonicalJson } from "./canonical-json";

const REMOTE_AGENT_TOOL_PROGRESS_PREFIX =
  "openmeld:remote-agent:tool-progress:";
const REMOTE_AGENT_TOOL_PROGRESS_RETENTION_MS = 60 * 60 * 1000;
const REMOTE_AGENT_TOOL_PROGRESS_CLEANUP_BATCH_SIZE = 64;
export const REMOTE_AGENT_TOOL_CALL_LIMIT = 64;
const REMOTE_AGENT_UNCHANGED_OBSERVATION_LIMIT = 3;
const REMOTE_AGENT_RECENT_OBSERVATION_LIMIT = 16;
const REMOTE_AGENT_TOOL_PROGRESS_WRITE_MAX_ATTEMPTS = 128;

type RemoteAgentObservationProgress = {
  callFingerprint: string;
  repeatCount: number;
  resultFingerprint: string;
  toolName: string;
};

type RemoteAgentToolProgressState = {
  callCount: number;
  expiresAtMs: number;
  observations: RemoteAgentObservationProgress[];
  v: 1;
};

export type RemoteAgentToolProgressTracking = "observation";

export type RemoteAgentToolAttempt = {
  callFingerprint?: string;
  callNumber: number;
  toolName: string;
};

export class RemoteAgentNoProgressError extends Error {
  readonly reasonCode = "remote_agent.tool_no_progress";
  readonly toolName: string;

  constructor(toolName: string) {
    super(
      "This exact read returned unchanged data three times. Do not run it again with the same input. Use different arguments or another source, or finish with the evidence already available."
    );
    this.name = "RemoteAgentNoProgressError";
    this.toolName = toolName;
  }
}

export class RemoteAgentToolCallBudgetExceededError extends Error {
  readonly limit = REMOTE_AGENT_TOOL_CALL_LIMIT;
  readonly reasonCode = "remote_agent.tool_call_budget_exceeded";

  constructor() {
    super(
      "This request reached OpenMeld's tool-call limit. Stop calling tools and finish with the evidence already available."
    );
    this.name = "RemoteAgentToolCallBudgetExceededError";
  }
}

export class RemoteAgentToolProgressStateInvalidError extends Error {
  readonly reasonCode = "remote_agent.tool_progress_state_invalid";

  constructor() {
    super(
      "Stored Remote Agent tool progress is invalid. Tool execution stopped without resetting the submission budget."
    );
    this.name = "RemoteAgentToolProgressStateInvalidError";
  }
}

export async function beginRemoteAgentToolAttempt(input: {
  nowMs?: number;
  progressTracking?: RemoteAgentToolProgressTracking;
  storage: RemoteAgentStorage;
  submissionId: string;
  toolInput: Record<string, unknown>;
  toolName: string;
}): Promise<RemoteAgentToolAttempt> {
  const nowMs = input.nowMs ?? Date.now();
  const callFingerprint =
    input.progressTracking === "observation"
      ? await digestCanonicalJson({
          input: input.toolInput,
          toolName: input.toolName,
        })
      : undefined;
  const expiresAtMs = nowMs + REMOTE_AGENT_TOOL_PROGRESS_RETENTION_MS;
  return await updateRemoteAgentToolProgressState({
    expiresAtMs,
    nowMs,
    storage: input.storage,
    submissionId: input.submissionId,
    update: (current) => {
      const matchingObservation = current?.observations.find(
        (observation) => observation.callFingerprint === callFingerprint
      );
      if (
        callFingerprint &&
        matchingObservation &&
        matchingObservation.repeatCount >=
          REMOTE_AGENT_UNCHANGED_OBSERVATION_LIMIT
      ) {
        throw new RemoteAgentNoProgressError(input.toolName);
      }
      const callCount = current?.callCount ?? 0;
      if (callCount >= REMOTE_AGENT_TOOL_CALL_LIMIT) {
        throw new RemoteAgentToolCallBudgetExceededError();
      }
      return {
        next: {
          callCount: callCount + 1,
          expiresAtMs,
          observations: current?.observations ?? [],
          v: 1,
        },
        result: {
          ...(callFingerprint ? { callFingerprint } : {}),
          callNumber: callCount + 1,
          toolName: input.toolName,
        },
      };
    },
  });
}

export async function recordRemoteAgentToolResultProgress(input: {
  attempt: RemoteAgentToolAttempt;
  nowMs?: number;
  result: unknown;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<void> {
  const callFingerprint = input.attempt.callFingerprint;
  if (!callFingerprint) {
    return;
  }
  const nowMs = input.nowMs ?? Date.now();
  const resultFingerprint = await digestCanonicalJson({ result: input.result });
  const expiresAtMs = nowMs + REMOTE_AGENT_TOOL_PROGRESS_RETENTION_MS;
  const repeatCount = await updateRemoteAgentToolProgressState({
    expiresAtMs,
    nowMs,
    storage: input.storage,
    submissionId: input.submissionId,
    update: (current) => {
      const observations = current?.observations ?? [];
      const previous = observations.find(
        (observation) => observation.callFingerprint === callFingerprint
      );
      const repeated = previous?.resultFingerprint === resultFingerprint;
      const nextRepeatCount = repeated ? previous.repeatCount + 1 : 1;
      const updatedObservation: RemoteAgentObservationProgress = {
        callFingerprint,
        repeatCount: nextRepeatCount,
        resultFingerprint,
        toolName: input.attempt.toolName,
      };
      return {
        next: {
          callCount: current?.callCount ?? input.attempt.callNumber,
          expiresAtMs,
          observations: [
            ...observations.filter(
              (observation) => observation.callFingerprint !== callFingerprint
            ),
            updatedObservation,
          ].slice(-REMOTE_AGENT_RECENT_OBSERVATION_LIMIT),
          v: 1,
        },
        result: nextRepeatCount,
      };
    },
  });
  if (repeatCount >= REMOTE_AGENT_UNCHANGED_OBSERVATION_LIMIT) {
    console.warn("[remote_agent.tool_progress.unchanged_observation_blocked]", {
      repeatCount,
      submissionId: input.submissionId,
      toolName: input.attempt.toolName,
    });
    throw new RemoteAgentNoProgressError(input.attempt.toolName);
  }
}

export async function cleanupExpiredRemoteAgentToolProgress(input: {
  nowMs?: number;
  storage: RemoteAgentStorage;
}): Promise<{ deleted: number; nextCleanupAtMs: number | null }> {
  const cleanup = await input.storage.deleteExpired({
    limit: REMOTE_AGENT_TOOL_PROGRESS_CLEANUP_BATCH_SIZE,
    nowMs: input.nowMs ?? Date.now(),
    prefix: REMOTE_AGENT_TOOL_PROGRESS_PREFIX,
  });
  return {
    deleted: cleanup.deleted,
    nextCleanupAtMs: cleanup.nextExpiresAtMs,
  };
}

function parseRemoteAgentToolProgressState(
  state: unknown,
  nowMs: number
): RemoteAgentToolProgressState | null {
  if (state === undefined) {
    return null;
  }
  if (!isRemoteAgentToolProgressState(state)) {
    throw new RemoteAgentToolProgressStateInvalidError();
  }
  if (state.expiresAtMs <= nowMs) {
    return null;
  }
  return state;
}

function isRemoteAgentToolProgressState(
  state: unknown
): state is RemoteAgentToolProgressState {
  if (!isRecord(state)) {
    return false;
  }
  if (
    state.v !== 1 ||
    !Number.isSafeInteger(state.callCount) ||
    (state.callCount as number) < 0 ||
    !Number.isSafeInteger(state.expiresAtMs) ||
    (state.expiresAtMs as number) <= 0 ||
    !Array.isArray(state.observations) ||
    state.observations.length > REMOTE_AGENT_RECENT_OBSERVATION_LIMIT
  ) {
    return false;
  }
  return state.observations.every(isRemoteAgentObservationProgress);
}

function isRemoteAgentObservationProgress(
  observation: unknown
): observation is RemoteAgentObservationProgress {
  return (
    isRecord(observation) &&
    typeof observation.callFingerprint === "string" &&
    observation.callFingerprint.length > 0 &&
    Number.isSafeInteger(observation.repeatCount) &&
    (observation.repeatCount as number) >= 1 &&
    typeof observation.resultFingerprint === "string" &&
    observation.resultFingerprint.length > 0 &&
    typeof observation.toolName === "string" &&
    observation.toolName.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildRemoteAgentToolProgressKey(submissionId: string): string {
  return `${REMOTE_AGENT_TOOL_PROGRESS_PREFIX}${encodeURIComponent(
    submissionId
  )}`;
}

async function updateRemoteAgentToolProgressState<Result>(input: {
  expiresAtMs: number;
  nowMs: number;
  storage: RemoteAgentStorage;
  submissionId: string;
  update: (current: RemoteAgentToolProgressState | null) => {
    next: RemoteAgentToolProgressState;
    result: Result;
  };
}): Promise<Result> {
  const key = buildRemoteAgentToolProgressKey(input.submissionId);
  for (
    let attempt = 0;
    attempt < REMOTE_AGENT_TOOL_PROGRESS_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const stored = await input.storage.get<unknown>(key);
    const transition = input.update(
      parseRemoteAgentToolProgressState(stored, input.nowMs)
    );
    const written =
      stored === undefined
        ? await input.storage.putIfAbsentExpiring(
            key,
            transition.next,
            input.expiresAtMs
          )
        : await input.storage.compareAndSetExpiring(
            key,
            stored,
            transition.next,
            input.expiresAtMs
          );
    if (written) {
      return transition.result;
    }
  }
  throw new Error(
    "Remote Agent tool progress could not be updated after repeated concurrent changes."
  );
}
