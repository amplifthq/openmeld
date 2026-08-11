import type { SpaceTargetWakeAvailability } from "../target-identity/target-catalog";

export function formatBlockedWakeAvailabilityLabel(
  wakeAvailability: SpaceTargetWakeAvailability
): string {
  const reason =
    wakeAvailability.status === "blocked"
      ? normalizeReasonText(wakeAvailability.reasonText)
      : null;
  return reason ? `Unavailable now: ${reason}` : "Unavailable now";
}

function normalizeReasonText(value: string | null): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  return normalized.endsWith(".")
    ? normalized.slice(0, Math.max(0, normalized.length - 1))
    : normalized;
}
