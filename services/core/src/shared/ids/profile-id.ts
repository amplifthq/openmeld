import { MAX_PROFILE_ID_LENGTH } from "@openmeld/protocol";

export function normalizeProfileId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_PROFILE_ID_LENGTH) {
    return null;
  }
  return normalized;
}
