import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";

const OPENMELD_SYSTEM_PROFILE_ID = "openmeld-system";
const OPENMELD_SYSTEM_PROFILE_NAME = "openmeld system";

type OpenMeldSystemProfileIdentityLike =
  | {
      kind?: unknown;
      openMeldProfileId?: unknown;
      profileId?: unknown;
      profileName?: unknown;
    }
  | null
  | undefined;

const normalizeProfileValue = (value: unknown): string =>
  sanitizeTerminalDisplayText(
    typeof value === "string" || typeof value === "number" ? value : "",
    "single-line"
  )
    .trim()
    .toLowerCase();

export function isOpenMeldSystemProfileIdentity(
  profileIdentity: OpenMeldSystemProfileIdentityLike
): boolean {
  if (!profileIdentity || typeof profileIdentity !== "object") {
    return false;
  }

  const kind = normalizeProfileValue(profileIdentity.kind);
  if (kind === "system") {
    return true;
  }

  const profileId = normalizeProfileValue(
    profileIdentity.openMeldProfileId ?? profileIdentity.profileId
  );
  if (profileId === OPENMELD_SYSTEM_PROFILE_ID) {
    return true;
  }

  const profileName = normalizeProfileValue(profileIdentity.profileName);
  return profileName === OPENMELD_SYSTEM_PROFILE_NAME;
}
