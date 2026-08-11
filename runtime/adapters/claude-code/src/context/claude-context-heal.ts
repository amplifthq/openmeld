const CLAUDE_CONTEXT_LOST_ERROR_PATTERNS = [
  /no\s+conversation\s+found\s+with\s+session\s+id/i,
  /--resume\s+requires\s+a\s+valid\s+session\s+id/i,
  /session.*not\s+found/i,
  /session.*invalid/i,
  /conversation.*not\s+found/i,
] as const;

export function isLikelyClaudeContextLostError(message: string): boolean {
  return CLAUDE_CONTEXT_LOST_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message)
  );
}
