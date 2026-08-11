export const DEFAULT_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DedupeWindowInput = {
  firstSeenAtMs: number;
  nowMs: number;
  windowMs?: number;
};

export const shouldDedupeWithinWindow = (input: DedupeWindowInput): boolean => {
  const windowMs = input.windowMs ?? DEFAULT_IDEMPOTENCY_WINDOW_MS;
  const elapsedMs = input.nowMs - input.firstSeenAtMs;
  return elapsedMs >= 0 && elapsedMs < windowMs;
};
