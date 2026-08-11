export const ROOT_ERROR_PATTERN =
  /\s*Try re-running the command as root for richer errors\.?/i;

export function sanitizeSystemServiceErrorMessage(message: string): string {
  return message.replace(ROOT_ERROR_PATTERN, "");
}
