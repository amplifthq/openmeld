/**
 * Truncates Inbox copy to the same UTF-16 code-unit limit enforced by Zod
 * without leaving a dangling high surrogate before the ellipsis.
 */
export function truncateInboxText(value: string, maxChars: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 0) {
    return "";
  }
  if (maxChars === 1) {
    return "…";
  }

  let truncated = normalized.slice(0, maxChars - 1).trimEnd();
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (finalCodeUnit >= 0xd8_00 && finalCodeUnit <= 0xdb_ff) {
    truncated = truncated.slice(0, -1).trimEnd();
  }
  return `${truncated}…`;
}
