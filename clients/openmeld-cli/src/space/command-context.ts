import {
  buildCommandAuthenticationPromptMessage,
  ensureCommandAuthenticationOrCancel,
} from "../auth/command-auth";
import { getCurrentCommandCheckState } from "../command-entry-checks/current-command-check-state";
import { resolveBaseUrl } from "../config/base-url";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { resolveOpenMeldProfileOrNull } from "../config/resolve-openmeld-profile";
import { resolveRuntimeContext } from "../runtime/context";
import {
  createSpaceProfileRequiredGuideError,
  createSpaceUnsupportedProfileKindGuideError,
} from "../runtime/dual-view-guide-catalog";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { formatMessage } from "../runtime/messages";
import { createPresenter } from "../runtime/presenter/index";

const SPACE_ID_HEX_REGEX = /^[0-9a-f]{64}$/i;
// Signal IDs are bare crypto.randomUUID() (canonical 36-char UUID). We lock only
// the shape (not the v4 version/variant nibbles) and accept upper-case, so a
// short prefix is caught locally without coupling to the id-generation strategy.
const SIGNAL_ID_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PreparedSpaceCommandContext = {
  status: "ready";
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
  interactive: boolean;
  baseUrl: string;
  authenticatedGatewayUrl: string | null;
};

export async function prepareAuthenticatedSpaceCommandContext(input: {
  profile?: string;
  baseUrl?: string;
  view?: string;
  promptMessage: string;
  checkGatewayMismatch?: boolean;
  entryChecksHandled?: boolean;
  runtime?: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter?: ReturnType<typeof createPresenter>;
  interactive?: boolean;
}): Promise<PreparedSpaceCommandContext | { status: "cancelled" }> {
  const runtime =
    input.runtime ??
    (await resolveRuntimeContext({
      profile: input.profile,
      view: input.view,
    }));
  const presenter = input.presenter ?? createPresenter(runtime);
  const interactive = input.interactive ?? canUseInteractivePrompts(runtime);
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  if (!input.entryChecksHandled) {
    const authReady = await ensureHumanSpaceCommandAuthenticationOrCancel({
      runtime,
      gatewayUrl: input.checkGatewayMismatch === false ? undefined : baseUrl,
      promptMessage: input.promptMessage,
      allowPrompt: interactive,
    });
    if (!authReady) {
      return {
        status: "cancelled",
      };
    }
  }

  return {
    status: "ready",
    runtime,
    presenter,
    interactive,
    baseUrl,
    authenticatedGatewayUrl:
      input.checkGatewayMismatch === false ? null : baseUrl,
  };
}

export async function ensureSpaceCommandGatewayAuthenticationOrCancel(input: {
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  allowPrompt: boolean;
  promptMessage: string;
  gatewayUrl: string;
  authenticatedGatewayUrl?: string | null;
}): Promise<string | null> {
  const targetGatewayUrl = normalizeOptionalString(input.gatewayUrl);
  if (!targetGatewayUrl) {
    return normalizeOptionalString(input.authenticatedGatewayUrl);
  }

  const authenticatedGatewayUrl = normalizeOptionalString(
    input.authenticatedGatewayUrl
  );
  if (
    authenticatedGatewayUrl !== null &&
    authenticatedGatewayUrl === targetGatewayUrl
  ) {
    return authenticatedGatewayUrl;
  }

  const authReady = await ensureHumanSpaceCommandAuthenticationOrCancel({
    runtime: input.runtime,
    gatewayUrl: targetGatewayUrl,
    promptMessage: input.promptMessage,
    allowPrompt: input.allowPrompt,
  });
  if (!authReady) {
    return null;
  }

  return targetGatewayUrl;
}

export function assertValidSpaceIdTarget(input: {
  space: string;
  resolvedView: "human" | "agent";
}): void {
  if (isValidSpaceId(input.space)) {
    return;
  }

  throw new Error(
    formatMessage(input.resolvedView, "space.target.invalid", {
      space: input.space,
    })
  );
}

// Reject a short/malformed signal id locally, before any network round-trip, so
// the user gets a clear "use the full id" message instead of a late upstream
// "anchor not found". Empty/unset values are not validated here — each command
// decides its own required-ness. Thread ids (thr_ prefix) are NOT signal ids and
// must not be passed through this guard.
export function assertFullSignalIdArgument(input: {
  value: string | undefined;
  flag:
    | "--after-signal"
    | "--around-signal"
    | "--reply-to"
    | "--signal"
    | "--thread-root-signal";
  resolvedView: "human" | "agent";
}): void {
  const normalized = String(input.value ?? "").trim();
  if (normalized.length === 0) {
    return;
  }
  if (SIGNAL_ID_UUID_REGEX.test(normalized)) {
    return;
  }
  throw new Error(
    formatMessage(input.resolvedView, "signal.id.invalid", {
      flag: input.flag,
      value: normalized,
    })
  );
}

export async function resolveOpenMeldProfileForSpaceCommand(input: {
  openMeldProfileId?: string;
  resolvedView: "human" | "agent";
  interactive: boolean;
}): Promise<OpenMeldProfile> {
  const currentSelectedProfile =
    getCurrentCommandCheckState().selectedProfile?.profile ?? null;
  if (
    currentSelectedProfile &&
    (String(input.openMeldProfileId ?? "").trim().length === 0 ||
      currentSelectedProfile.openMeldProfileId === input.openMeldProfileId)
  ) {
    if (
      !isProfileKindSupportedForSpaceCommand(currentSelectedProfile.profileKind)
    ) {
      throw createSpaceUnsupportedProfileKindGuideError({
        profileId: currentSelectedProfile.openMeldProfileId,
        profileKind: currentSelectedProfile.profileKind,
      });
    }
    return currentSelectedProfile;
  }

  const openMeldProfile = await resolveOpenMeldProfileOrNull({
    openMeldProfileId: input.openMeldProfileId,
    persistSelection: false,
    allowDefaultFallback: false,
  });
  if (openMeldProfile) {
    if (!isProfileKindSupportedForSpaceCommand(openMeldProfile.profileKind)) {
      throw createSpaceUnsupportedProfileKindGuideError({
        profileId: openMeldProfile.openMeldProfileId,
        profileKind: openMeldProfile.profileKind,
      });
    }
    return openMeldProfile;
  }

  const canBootstrapDefaultHumanProfile =
    input.resolvedView === "human" &&
    input.interactive &&
    String(input.openMeldProfileId ?? "").trim().length === 0;
  if (canBootstrapDefaultHumanProfile) {
    const fallbackHumanProfile = await resolveOpenMeldProfileOrNull({
      profileKind: "human",
      persistSelection: true,
      allowDefaultFallback: true,
    });
    if (fallbackHumanProfile) {
      return fallbackHumanProfile;
    }
  }

  throw createSpaceProfileRequiredGuideError();
}

export function buildSpaceReadAuthenticationPromptMessage(
  action: string
): string {
  return buildCommandAuthenticationPromptMessage(action);
}

async function ensureHumanSpaceCommandAuthenticationOrCancel(input: {
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  promptMessage: string;
  allowPrompt: boolean;
  gatewayUrl?: string;
}): Promise<boolean> {
  if (input.runtime.resolvedView !== "human") {
    return true;
  }

  return await ensureCommandAuthenticationOrCancel({
    runtime: input.runtime,
    ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
    promptMessage: input.promptMessage,
    allowPrompt: input.allowPrompt,
  });
}

function isValidSpaceId(space: string): boolean {
  return SPACE_ID_HEX_REGEX.test(space.trim());
}

function isProfileKindSupportedForSpaceCommand(profileKind: string): boolean {
  return profileKind === "human" || profileKind === "agent";
}

function normalizeOptionalString(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
