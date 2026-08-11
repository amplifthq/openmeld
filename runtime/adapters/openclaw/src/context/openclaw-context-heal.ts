const OPENCLAW_CONTEXT_LOST_ERROR_PATTERNS = [
  /no\s+session\s+found/i,
  /session\s+id\s+not\s+found/i,
  /session\s+not\s+found/i,
  /session\s+.*\s+invalid/i,
  /invalid\s+session\s+id/i,
  /unknown\s+session/i,
  /--session-id\s+requires\s+a\s+valid\s+id/i,
] as const;

export function isLikelyOpenClawContextLostError(message: string): boolean {
  return OPENCLAW_CONTEXT_LOST_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message)
  );
}
