export const DEFAULT_DISPATCH_MAX_ATTEMPTS = 3;
export const DEFAULT_UNKNOWN_ERROR_MAX_ATTEMPTS = 3;
export const DEFAULT_DISPATCH_OFFLINE_MAX_ATTEMPTS = 3;
export const DEFAULT_DISPATCH_RETRY_BACKOFF_SECONDS = [
  1, 3, 10, 30, 60, 120,
] as const;
export const DEFAULT_DISPATCH_OFFLINE_RETRY_BACKOFF_SECONDS = [
  3, 10, 30, 60,
] as const;
export const DEFAULT_DISPATCH_RETRY_JITTER_RATIO = 0.2;

export const shouldRetryByAttemptBudget = (input: {
  attempt: number;
  maxAttempts?: number;
}): boolean => {
  const maxAttempts = input.maxAttempts ?? DEFAULT_DISPATCH_MAX_ATTEMPTS;
  return input.attempt < maxAttempts;
};

export const computeRetryDelaySeconds = (input: {
  attempt: number;
  random?: () => number;
  backoffSeconds?: readonly number[];
  jitterRatio?: number;
}): number => {
  const backoffSeconds =
    input.backoffSeconds ?? DEFAULT_DISPATCH_RETRY_BACKOFF_SECONDS;
  const jitterRatio = input.jitterRatio ?? DEFAULT_DISPATCH_RETRY_JITTER_RATIO;
  const attemptIndex = Math.max(1, input.attempt) - 1;
  const fallbackDelaySeconds = backoffSeconds.at(-1) ?? 120;
  const delayBaseSeconds =
    backoffSeconds[Math.min(attemptIndex, backoffSeconds.length - 1)] ??
    fallbackDelaySeconds;

  const random = input.random ?? Math.random;
  const normalizedRandom = Math.min(1, Math.max(0, random()));
  const maxJitterSeconds = delayBaseSeconds * jitterRatio;
  const jitterSeconds = (normalizedRandom * 2 - 1) * maxJitterSeconds;

  return Math.max(1, Math.round(delayBaseSeconds + jitterSeconds));
};
