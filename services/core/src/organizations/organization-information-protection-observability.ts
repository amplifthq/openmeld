const INFORMATION_PROTECTION_ERROR_MAX_CHARS = 240;
const whitespacePattern = /\s+/g;

export function summarizeInformationProtectionError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalized = rawMessage.replace(whitespacePattern, " ").trim();
  const summary = normalized || "Unknown information protection error";
  if (summary.length <= INFORMATION_PROTECTION_ERROR_MAX_CHARS) {
    return summary;
  }
  return `${summary.slice(0, INFORMATION_PROTECTION_ERROR_MAX_CHARS - 1)}…`;
}
