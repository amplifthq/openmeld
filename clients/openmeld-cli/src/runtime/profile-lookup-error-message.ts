export function toProfileLookupErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : "Unknown profile lookup error.";
  }

  const message = String(error ?? "").trim();
  return message.length > 0 ? message : "Unknown profile lookup error.";
}
