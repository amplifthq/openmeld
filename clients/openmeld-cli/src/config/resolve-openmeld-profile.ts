import {
  createAuthenticationError,
  resolveAuthenticationGuidanceFromError,
  resolveAuthenticationReasonFromState,
} from "../auth/auth-guidance";
import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { getAuthSessionState } from "./auth-session";
import {
  clearSelectedOpenMeldProfileId,
  getSelectedOpenMeldProfileId,
  setSelectedOpenMeldProfileId,
} from "./openmeld-profile-selection";
import {
  type OpenMeldProfile,
  type OpenMeldProfileKind,
  resolveOpenMeldProfile,
  resolveOpenMeldProfileByIdOrName,
} from "./openmeld-profiles-api";

export type ResolveOpenMeldProfileInput = {
  openMeldProfileId?: string;
  profileKind?: OpenMeldProfileKind;
  allowUnauthenticated?: boolean;
  persistSelection?: boolean;
  allowDefaultFallback?: boolean;
  authAction?: string;
};

const PROFILE_REQUIRED_ERROR_ROOT =
  "no OpenMeld profile is selected for this terminal session yet";
const PROFILE_REQUIRED_ERROR_MESSAGE = `${PROFILE_REQUIRED_ERROR_ROOT}; run \`openmeld start\` to choose one, or pass \`--profile <id>\`.`;
const SERVICE_TRACE_PROFILE_REQUIRED_ERROR_MESSAGE = `${PROFILE_REQUIRED_ERROR_ROOT}; dispatch trace needs an acting profile. Run \`openmeld profile set <profile-id>\` once, or pass \`--profile <profile-id>\` with this trace command. \`--target-profile\` only identifies the agent being traced.`;
const PROFILE_REQUIRED_ERROR_PREFIX =
  "no OpenMeld profile is selected for this terminal session yet; run `";
const PROFILE_REQUIRED_ERROR_SUFFIX =
  " start` to choose one, or pass `--profile <id>`.";

export function isSelectedOpenMeldProfileRequiredError(
  error: unknown
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.message === PROFILE_REQUIRED_ERROR_MESSAGE) {
    return true;
  }

  if (
    error.message.includes(PROFILE_REQUIRED_ERROR_ROOT) &&
    error.message.includes("--profile <")
  ) {
    return true;
  }

  return (
    error.message.startsWith(PROFILE_REQUIRED_ERROR_PREFIX) &&
    error.message.endsWith(PROFILE_REQUIRED_ERROR_SUFFIX)
  );
}

export async function resolveOpenMeldProfileOrNull(
  input: ResolveOpenMeldProfileInput = {}
): Promise<OpenMeldProfile | null> {
  const explicitOpenMeldProfileId = normalizeOptionalString(
    input.openMeldProfileId
  );
  if (explicitOpenMeldProfileId) {
    return await resolveExplicitOpenMeldProfile(explicitOpenMeldProfileId, {
      profileKind: input.profileKind,
      allowUnauthenticated: input.allowUnauthenticated === true,
      persistSelection: input.persistSelection !== false,
    });
  }

  const selectedOpenMeldProfileId = await getSelectedOpenMeldProfileId();
  if (selectedOpenMeldProfileId) {
    const selectedProfile = await resolveSelectedOpenMeldProfile(
      selectedOpenMeldProfileId,
      {
        profileKind: input.profileKind,
        allowUnauthenticated: input.allowUnauthenticated === true,
      }
    );
    if (selectedProfile) {
      return selectedProfile;
    }
  }

  if (input.allowUnauthenticated === true) {
    const authState = await getAuthSessionState({
      validateRemote: false,
    });
    if (authState.state !== "valid") {
      return null;
    }
  }

  if (input.allowDefaultFallback !== true) {
    return null;
  }

  let fallbackProfile: OpenMeldProfile;
  try {
    fallbackProfile = await resolveOpenMeldProfile({
      profileKind: input.profileKind,
    });
  } catch (error) {
    if (input.allowUnauthenticated === true && isAuthRequiredError(error)) {
      return null;
    }
    throw error;
  }
  if (input.persistSelection !== false) {
    await setSelectedOpenMeldProfileId(fallbackProfile.openMeldProfileId);
  }
  return fallbackProfile;
}

async function resolveExplicitOpenMeldProfile(
  openMeldProfileId: string,
  input: {
    profileKind?: OpenMeldProfileKind;
    allowUnauthenticated: boolean;
    persistSelection: boolean;
  }
): Promise<OpenMeldProfile | null> {
  try {
    const profile = await resolveOpenMeldProfileByIdOrName({
      profileIdentifier: openMeldProfileId,
      profileKind: input.profileKind,
    });
    if (input.persistSelection) {
      await setSelectedOpenMeldProfileId(profile.openMeldProfileId);
    }
    return profile;
  } catch (error) {
    if (isAuthRequiredError(error) && input.allowUnauthenticated) {
      return null;
    }
    throw error;
  }
}

export async function requireOpenMeldProfile(
  input: ResolveOpenMeldProfileInput = {}
): Promise<OpenMeldProfile> {
  const profile = await resolveOpenMeldProfileOrNull(input);
  if (profile) {
    return profile;
  }

  const authState = await getAuthSessionState({
    validateRemote: false,
  });
  if (authState.state === "valid") {
    throw new Error(
      formatInlineOpenMeldCliCommands(
        resolveProfileRequiredErrorMessage(input.authAction)
      )
    );
  }
  const reason = resolveAuthenticationReasonFromState(authState.state);
  throw createAuthenticationError({
    reason: reason ?? "required",
    action: input.authAction,
  });
}

function resolveProfileRequiredErrorMessage(authAction?: string): string {
  if (authAction === "reading a dispatch trace") {
    return SERVICE_TRACE_PROFILE_REQUIRED_ERROR_MESSAGE;
  }

  return PROFILE_REQUIRED_ERROR_MESSAGE;
}

async function resolveSelectedOpenMeldProfile(
  selectedOpenMeldProfileId: string,
  input: {
    profileKind?: OpenMeldProfileKind;
    allowUnauthenticated: boolean;
  }
): Promise<OpenMeldProfile | null> {
  try {
    return await resolveOpenMeldProfile({
      openMeldProfileId: selectedOpenMeldProfileId,
      profileKind: input.profileKind,
    });
  } catch (error) {
    if (isAuthRequiredError(error)) {
      if (input.allowUnauthenticated) {
        return null;
      }
      throw error;
    }

    if (isProfileMissingError(error)) {
      await clearSelectedOpenMeldProfileId();
      return null;
    }

    throw error;
  }
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isAuthRequiredError(error: unknown): boolean {
  return resolveAuthenticationGuidanceFromError(error) !== null;
}

function isProfileMissingError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  if (code === "profile.not_found") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("profile not found");
}
