const CONTEXT_LOST_ERROR_PATTERNS = [
  /thread.*not\s+found/i,
  /session.*not\s+found/i,
  /conversation.*not\s+found/i,
  /unknown\s+thread/i,
  /invalid\s+thread/i,
  /cannot\s+resume/i,
  /resume.*failed/i,
] as const;

export function isLikelyContextLostError(message: string): boolean {
  return CONTEXT_LOST_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
