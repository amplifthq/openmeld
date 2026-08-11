// Fast-start schedule for readiness-polling retry loops: 250/500/1000ms, then
// capped at 2000ms for every attempt beyond it.
const RETRY_DELAY_SCHEDULE_MS: readonly number[] = [250, 500, 1000, 2000];
const RETRY_DELAY_CAP_MS = 2000;

// `attempt` is the 1-indexed retry number (the delay taken after that attempt fails).
export function computeRetryDelayMs(attempt: number): number {
  const index = Math.max(
    0,
    Math.min(attempt - 1, RETRY_DELAY_SCHEDULE_MS.length - 1)
  );
  return RETRY_DELAY_SCHEDULE_MS[index] ?? RETRY_DELAY_CAP_MS;
}
