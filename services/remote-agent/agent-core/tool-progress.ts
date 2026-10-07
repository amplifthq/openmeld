import { REMOTE_AGENT_TOOL_SAFETY_LIMIT_REASON_CODE } from "@openmeld/schemas";
import { digestCanonicalJson } from "@openmeld/utils";
import {
  type RemoteAgentStorage,
  readRemoteAgentCallbackContext,
} from "./callback-context";

const REMOTE_AGENT_TOOL_PROGRESS_PREFIX =
  "openmeld:remote-agent:tool-progress:";
const REMOTE_AGENT_TOOL_PROGRESS_RETENTION_MS = 60 * 60 * 1000;
const REMOTE_AGENT_TOOL_PROGRESS_CLEANUP_BATCH_SIZE = 64;
// Deployment-owned coarse runaway protection, not a model cost meter or a
// checkpoint interval. Normal productive work stays in the same execution.
export const REMOTE_AGENT_TOOL_CALL_LIMIT = 4096;
const POSITIVE_INTEGER_PATTERN = /^\d+$/;
export function resolveRemoteAgentToolCallLimit(value?: string): number {
  if (value === undefined) {
    return REMOTE_AGENT_TOOL_CALL_LIMIT;
  }
  const limit = Number(value);
  if (
    !(POSITIVE_INTEGER_PATTERN.test(value) && Number.isSafeInteger(limit)) ||
    limit < 1
  ) {
    throw new RemoteAgentToolProgressStateInvalidError();
  }
  return limit;
}
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
  callLimit?: number;
  lastSubmissionId?: string;
  expiresAtMs: number;
  observations: RemoteAgentObservationProgress[];
  v: 1;
};

export type RemoteAgentToolProgressTracking = "observation";

export type RemoteAgentToolAttempt = {
  callLimit: number;
  callFingerprint?: string;
  callNumber: number;
  toolName: string;
};

export class RemoteAgentNoProgressError extends Error {
  readonly reasonCode = "remote_agent.tool_no_progress";
  readonly toolName: string;
  readonly attempt?: RemoteAgentToolAttempt;

  constructor(toolName: string, attempt?: RemoteAgentToolAttempt) {
    super(
      "This read returned unchanged data three times. Recover prior retained results with openmeld_read_tool_result (omit fields to list references). For Computer work, use computer_command list/poll with the original key; do not restart it. Reconcile the evidence already collected, then address a specific unresolved question or report what remains unknown. Changing arguments alone is not new progress."
    );
    this.name = "RemoteAgentNoProgressError";
    this.toolName = toolName;
    this.attempt = attempt;
  }
}

export class RemoteAgentToolCallBudgetExceededError extends Error {
  readonly limit: number;
  readonly reasonCode = REMOTE_AGENT_TOOL_SAFETY_LIMIT_REASON_CODE;

  constructor(limit = REMOTE_AGENT_TOOL_CALL_LIMIT) {
    super(
      "This assignment reached OpenMeld's safety limit. Execution is incomplete and has been stopped; do not report it as completed or repeat its actions."
    );
    this.limit = limit;
    this.name = "RemoteAgentToolCallBudgetExceededError";
  }
}

export class RemoteAgentToolProgressStateInvalidError extends Error {
  readonly reasonCode = "remote_agent.tool_progress_state_invalid";

  constructor() {
    super(
      "Stored Remote Agent tool progress is invalid. Tool execution stopped without resetting the assignment safety limit."
    );
    this.name = "RemoteAgentToolProgressStateInvalidError";
  }
}

export async function beginRemoteAgentToolAttempt(input: {
  callLimit?: number;
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
  const expiresAtMs = Number.MAX_SAFE_INTEGER;
  const { attempt, refused } = await updateRemoteAgentToolProgressState({
    expiresAtMs,
    nowMs,
    storage: input.storage,
    submissionId: input.submissionId,
    update: (current) => {
      const matchingObservation = current?.observations.find(
        (observation) => observation.callFingerprint === callFingerprint
      );
      const callCount = current?.callCount ?? 0;
      const callLimit =
        current?.callLimit ?? input.callLimit ?? REMOTE_AGENT_TOOL_CALL_LIMIT;
      if (!Number.isSafeInteger(callLimit) || callLimit < 1) {
        throw new RemoteAgentToolProgressStateInvalidError();
      }
      if (callCount >= callLimit) {
        throw new RemoteAgentToolCallBudgetExceededError(callLimit);
      }
      return {
        next: {
          callCount: callCount + 1,
          callLimit,
          expiresAtMs,
          observations: current?.observations ?? [],
          v: 1,
        },
        result: {
          refused:
            !!matchingObservation &&
            matchingObservation.repeatCount >=
              REMOTE_AGENT_UNCHANGED_OBSERVATION_LIMIT,
          attempt: {
            callLimit,
            ...(callFingerprint ? { callFingerprint } : {}),
            callNumber: callCount + 1,
            toolName: input.toolName,
          },
        },
      };
    },
  });
  // Refusals still consume a round of model/tool execution. Persist the charge
  // before rejecting the redundant read, so direct calls cannot loop for free.
  if (refused) {
    throw new RemoteAgentNoProgressError(input.toolName, attempt);
  }
  return attempt;
}

export async function recordRemoteAgentToolResultProgress(input: {
  attempt: RemoteAgentToolAttempt;
  nowMs?: number;
  result: unknown;
  progressValue?: (result: unknown) => unknown;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<void> {
  const callFingerprint = input.attempt.callFingerprint;
  if (!callFingerprint) {
    return;
  }
  const nowMs = input.nowMs ?? Date.now();
  const resultFingerprint = await digestCanonicalJson({
    result: input.progressValue
      ? input.progressValue(input.result)
      : input.result,
  });
  const expiresAtMs = Number.MAX_SAFE_INTEGER;
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
          callLimit: current?.callLimit,
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
  _nowMs: number
): RemoteAgentToolProgressState | null {
  if (state === undefined) {
    return null;
  }
  if (!isRemoteAgentToolProgressState(state)) {
    throw new RemoteAgentToolProgressStateInvalidError();
  }
  // An idle execution can still resume. Expiry must not refill its allowance.
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
    (state.lastSubmissionId !== undefined &&
      (typeof state.lastSubmissionId !== "string" ||
        state.lastSubmissionId.length === 0)) ||
    (state.callLimit !== undefined &&
      (!Number.isSafeInteger(state.callLimit) ||
        (state.callLimit as number) < 1)) ||
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
  const context = await readRemoteAgentCallbackContext(
    input.storage,
    input.submissionId
  );
  const key = context
    ? buildRemoteAgentToolProgressKey(
        JSON.stringify([
          context.organizationId,
          context.agentProfileId,
          context.dispatchId,
        ])
      )
    : buildRemoteAgentToolProgressKey(input.submissionId);
  const initial =
    context && (await input.storage.get(key)) === undefined
      ? await readLegacyAssignmentProgress({ ...input, context })
      : null;
  for (
    let attempt = 0;
    attempt < REMOTE_AGENT_TOOL_PROGRESS_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const stored = await input.storage.get<unknown>(key);
    const transition = input.update(
      parseRemoteAgentToolProgressState(stored, input.nowMs) ?? initial
    );
    const next = { ...transition.next, lastSubmissionId: input.submissionId };
    const written =
      stored === undefined
        ? await input.storage.putIfAbsent(key, next)
        : await input.storage.compareAndSet(key, stored, next);
    if (written) {
      return transition.result;
    }
  }
  throw new Error(
    "Remote Agent tool progress could not be updated after repeated concurrent changes."
  );
}

async function readLegacyAssignmentProgress(input: {
  context: import("./callback-context").RemoteAgentCallbackContext;
  storage: RemoteAgentStorage;
  submissionId: string;
  nowMs: number;
  expiresAtMs: number;
}): Promise<RemoteAgentToolProgressState> {
  const { context } = input;
  let legacyCount = 0;
  let legacyObservations: RemoteAgentObservationProgress[] = [];
  {
    let cursor: typeof context | null = context;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor.submissionId)) {
        throw new RemoteAgentToolProgressStateInvalidError();
      }
      seen.add(cursor.submissionId);
      const legacy = parseRemoteAgentToolProgressState(
        await input.storage.get(
          buildRemoteAgentToolProgressKey(cursor.submissionId)
        ),
        input.nowMs
      );
      if (
        cursor.submissionId !== input.submissionId &&
        !(legacy || cursor.workLoopCheckpoint)
      ) {
        throw new RemoteAgentToolProgressStateInvalidError();
      }
      legacyCount +=
        legacy?.callCount ?? cursor.workLoopCheckpoint?.toolCallLimit ?? 0;
      if (cursor.submissionId === input.submissionId) {
        legacyObservations = legacy?.observations ?? [];
      }
      const previousId: string | undefined =
        cursor.turnEnvelope?.workLoopContinuation?.previousSubmissionId;
      cursor = previousId
        ? await readRemoteAgentCallbackContext(input.storage, previousId)
        : null;
      if (previousId && !cursor) {
        throw new RemoteAgentToolProgressStateInvalidError();
      }
      if (
        cursor &&
        (cursor.dispatchId !== context.dispatchId ||
          cursor.organizationId !== context.organizationId ||
          cursor.agentProfileId !== context.agentProfileId)
      ) {
        throw new RemoteAgentToolProgressStateInvalidError();
      }
    }
  }
  return {
    callCount: legacyCount,
    observations: legacyObservations,
    expiresAtMs: input.expiresAtMs,
    v: 1,
  };
}

/** Called only after Core accepts a terminal (non-continuation) callback. */
export async function retainFinalizedRemoteAgentToolProgress(input: {
  context: import("./callback-context").RemoteAgentCallbackContext;
  nowMs: number;
  storage: RemoteAgentStorage;
}): Promise<void> {
  const { context } = input;
  const key = buildRemoteAgentToolProgressKey(
    JSON.stringify([
      context.organizationId,
      context.agentProfileId,
      context.dispatchId,
    ])
  );
  const current = await input.storage.get<RemoteAgentToolProgressState>(key);
  if (!current || current.lastSubmissionId !== context.submissionId) {
    return;
  }
  const expiresAtMs = input.nowMs + REMOTE_AGENT_TOOL_PROGRESS_RETENTION_MS;
  await input.storage.compareAndSetExpiring(
    key,
    current,
    { ...current, expiresAtMs },
    expiresAtMs
  );
}
