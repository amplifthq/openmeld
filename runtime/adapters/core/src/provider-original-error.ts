import {
  isOriginalErrorSafeForMessageDetails,
  OPENMELD_ORIGINAL_ERROR_MAX_LENGTH,
} from "@openmeld/schemas";

export function createProviderOriginalError(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    !isOriginalErrorSafeForMessageDetails(normalized)
  ) {
    return null;
  }

  return normalized.slice(0, OPENMELD_ORIGINAL_ERROR_MAX_LENGTH);
}
