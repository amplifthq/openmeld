const DISPLAY_NOT_SET_UP = "Not set up";

export function formatTransportModeDisplay(
  value: string | null | undefined
): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "not configured") {
    return DISPLAY_NOT_SET_UP;
  }
  if (normalized === "local-cli") {
    return "Local CLI";
  }
  if (normalized === "codex-app-server") {
    return "Codex App Server";
  }
  if (normalized === "acp") {
    return "Agent Client Protocol (ACP)";
  }
  return normalized;
}
