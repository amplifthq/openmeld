export const MIN_VISIBLE_ELAPSED_TIME_MS = 100;

export function resolveElapsedTimeMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

export function formatElapsedTime(durationMs: number): string {
  const seconds = durationMs / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}
