import {
  computeRetryDelaySeconds,
  DEFAULT_DISPATCH_MAX_ATTEMPTS,
  DEFAULT_DISPATCH_OFFLINE_MAX_ATTEMPTS,
  DEFAULT_DISPATCH_OFFLINE_RETRY_BACKOFF_SECONDS,
  DEFAULT_DISPATCH_RETRY_BACKOFF_SECONDS,
  DEFAULT_DISPATCH_RETRY_JITTER_RATIO,
  DEFAULT_IDEMPOTENCY_WINDOW_MS,
  DEFAULT_UNKNOWN_ERROR_MAX_ATTEMPTS,
  shouldDedupeWithinWindow as shouldDedupeWithinWindowShared,
  shouldRetryByAttemptBudget,
} from "@openmeld/agent-runtime";

export const DISPATCH_IDEMPOTENCY_WINDOW_MS = DEFAULT_IDEMPOTENCY_WINDOW_MS;
export const DISPATCH_MAX_ATTEMPTS = DEFAULT_DISPATCH_MAX_ATTEMPTS;
export const DISPATCH_OFFLINE_RETRY_MAX_ATTEMPTS = Math.max(
  DEFAULT_DISPATCH_OFFLINE_MAX_ATTEMPTS,
  4
);
export const DISPATCH_OFFLINE_RETRY_BACKOFF_SECONDS =
  DEFAULT_DISPATCH_OFFLINE_RETRY_BACKOFF_SECONDS;
export const DISPATCH_UNKNOWN_ERROR_MAX_ATTEMPTS =
  DEFAULT_UNKNOWN_ERROR_MAX_ATTEMPTS;
export const DISPATCH_RETRY_BACKOFF_SECONDS =
  DEFAULT_DISPATCH_RETRY_BACKOFF_SECONDS;
export const DISPATCH_RETRY_JITTER_RATIO = DEFAULT_DISPATCH_RETRY_JITTER_RATIO;
export const DISPATCH_DEDUPE_WINDOW_RISK_RATIO = 0.9;
export const DISPATCH_DEDUPE_WINDOW_RISK_CODE = "dispatch.dedupe.window_risk";
export const DISPATCH_SELF_TRIGGER_ERROR_CODE = "dispatch.blocked.self_trigger";
export const DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS = 20_000;

export const shouldRetryDispatchAttempt = (attempt: number): boolean => {
  return shouldRetryByAttemptBudget({
    attempt,
    maxAttempts: DISPATCH_MAX_ATTEMPTS,
  });
};

export const shouldRetryUnknownDispatchAttempt = (attempt: number): boolean => {
  return shouldRetryByAttemptBudget({
    attempt,
    maxAttempts: DISPATCH_UNKNOWN_ERROR_MAX_ATTEMPTS,
  });
};

export const shouldDedupeWithinWindow = (input: {
  firstSeenAtMs: number;
  nowMs: number;
  windowMs?: number;
}): boolean => {
  return shouldDedupeWithinWindowShared({
    firstSeenAtMs: input.firstSeenAtMs,
    nowMs: input.nowMs,
    ...(typeof input.windowMs === "number" ? { windowMs: input.windowMs } : {}),
  });
};

export const computeDispatchRetryDelaySeconds = (input: {
  attempt: number;
  random?: () => number;
  backoffSeconds?: readonly number[];
  jitterRatio?: number;
}): number => {
  return computeRetryDelaySeconds({
    attempt: input.attempt,
    random: input.random,
    backoffSeconds: input.backoffSeconds ?? DISPATCH_RETRY_BACKOFF_SECONDS,
    jitterRatio: input.jitterRatio ?? DISPATCH_RETRY_JITTER_RATIO,
  });
};

export const isDispatchDedupeWindowRisk = (queueLagMs: number): boolean => {
  return (
    queueLagMs >=
    DISPATCH_IDEMPOTENCY_WINDOW_MS * DISPATCH_DEDUPE_WINDOW_RISK_RATIO
  );
};
