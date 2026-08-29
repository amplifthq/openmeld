export const READ_POSITION_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function isReadPositionWithinAllowedFutureSkew(input: {
  nowMs: number;
  positionMs: number;
}): boolean {
  return (
    Number.isInteger(input.positionMs) &&
    input.positionMs >= 0 &&
    input.positionMs <= input.nowMs + READ_POSITION_MAX_FUTURE_SKEW_MS
  );
}
