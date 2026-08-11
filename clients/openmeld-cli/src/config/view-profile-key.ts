import { getSelectedOpenMeldProfileId } from "./openmeld-profile-selection";
import { resolveOpenMeldProfileByIdOrName } from "./openmeld-profiles-api";

export async function resolveViewProfileKey(
  inputProfile?: string
): Promise<string | null> {
  const explicit = normalizeOptionalString(inputProfile);
  if (explicit) {
    const profile = await resolveOpenMeldProfileByIdOrName({
      profileIdentifier: explicit,
    }).catch(() => null);
    return profile?.openMeldProfileId ?? explicit;
  }

  const selected = await getSelectedOpenMeldProfileId();
  if (selected) {
    return selected;
  }

  return null;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
