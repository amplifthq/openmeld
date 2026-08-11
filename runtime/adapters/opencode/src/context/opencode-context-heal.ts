export function isLikelyOpenCodeContextLostError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("session") &&
    (normalized.includes("not found") ||
      normalized.includes("missing") ||
      normalized.includes("invalid") ||
      normalized.includes("expired") ||
      normalized.includes("deleted"))
  );
}
