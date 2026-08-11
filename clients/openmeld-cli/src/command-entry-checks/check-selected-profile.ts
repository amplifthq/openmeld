import { cancel, isCancel, select } from "@clack/prompts";
import {
  clearSelectedOpenMeldProfileId,
  setSelectedOpenMeldProfileId,
} from "../config/openmeld-profile-selection";
import {
  type OpenMeldProfile,
  resolveOpenMeldProfile,
} from "../config/openmeld-profiles-api";
import { resolveOpenMeldProfileOrNull } from "../config/resolve-openmeld-profile";
import {
  type CreateProfileKind,
  createProfileByKind,
  resolveCreateProfileKind,
  resolveCreateProfileName,
} from "../profile/create-flow";
import {
  listVisibleOpenMeldProfilesForView,
  promptForOpenMeldProfileSelection,
  SPACE_COMMAND_PROFILE_SELECTION_MESSAGE,
  SPACE_JOIN_PROFILE_SELECTION_MESSAGE,
} from "../profile/profile-selection-prompt";
import { formatOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { buildAgentCheckResult } from "./build-agent-check-result";
import { getCommandEntryCopy } from "./command-entry-copy";
import { getCurrentCommandCheckState } from "./current-command-check-state";
import {
  buildBlockedEntryCheckResult,
  ENTRY_CHECK_BLOCKED_ERROR_CODES,
} from "./entry-check-blocked-json";
import { showHumanCheckCard } from "./show-human-check-card";
import type {
  CommandCheckRequirement,
  CommandEntryContext,
  CommandEntryResult,
} from "./types";

const CHOOSE_PROFILE = "__command_entry_choose_profile__";
const CREATE_PROFILE = "__command_entry_create_profile__";
const CANCEL_PROFILE = "__command_entry_cancel_profile__";

export async function runSelectedProfileCheck(input: {
  context: CommandEntryContext;
  requirement: CommandCheckRequirement;
}): Promise<CommandEntryResult> {
  const explicitProfileArg = normalizeOptionalString(input.context.profileArg);
  const hasExplicitProfileArg = explicitProfileArg !== null;
  const requiresConfirmation =
    input.requirement.mode === "confirm" &&
    input.context.runtime.resolvedView === "human" &&
    input.context.allowPrompt &&
    !hasExplicitProfileArg;
  const currentState = getCurrentCommandCheckState();
  const resolvedProfile = await resolveOpenMeldProfileOrNull({
    ...(explicitProfileArg ? { openMeldProfileId: explicitProfileArg } : {}),
    allowDefaultFallback: false,
    persistSelection: !hasExplicitProfileArg,
    allowUnauthenticated: false,
  }).catch(() => null);

  if (hasExplicitProfileArg) {
    currentState.selectedProfile = resolvedProfile
      ? {
          openMeldProfileId: resolvedProfile.openMeldProfileId,
          profile: resolvedProfile,
        }
      : null;
    return {
      status: "continue",
    };
  }

  if (requiresConfirmation) {
    const currentProfileForConfirmation =
      await resolveCurrentProfileForConfirmation({
        context: input.context,
        resolvedProfile,
      });
    const visibleProfiles = ensureCurrentProfileIsVisible({
      visibleProfiles: await listVisibleProfiles(input.context),
      currentProfile: currentProfileForConfirmation,
    });
    if (visibleProfiles.length > 0) {
      const profileId = await promptForExistingProfile({
        context: input.context,
        visibleProfiles,
        currentProfileId:
          currentProfileForConfirmation?.openMeldProfileId ?? null,
        message: resolveProfileConfirmationMessage(input.context.entryName),
      });
      if (!profileId) {
        return {
          status: "cancelled",
        };
      }
      const profile = await resolveOpenMeldProfile({
        openMeldProfileId: profileId,
      });
      currentState.selectedProfile = {
        openMeldProfileId: profile.openMeldProfileId,
        profile,
      };
      return {
        status: "continue",
      };
    }
  }

  if (resolvedProfile) {
    currentState.selectedProfile = {
      openMeldProfileId: resolvedProfile.openMeldProfileId,
      profile: resolvedProfile,
    };
    return {
      status: "continue",
    };
  }

  currentState.selectedProfile = null;
  if (input.requirement.mode === "status-only") {
    emitSelectedProfileStatus({
      context: input.context,
      blocking: false,
      profilesFound: false,
    });
    return {
      status: "continue",
    };
  }

  if (input.requirement.mode !== "required" && !requiresConfirmation) {
    return {
      status: "continue",
    };
  }

  if (input.context.jsonOutput) {
    return buildBlockedEntryCheckResult({
      code: ENTRY_CHECK_BLOCKED_ERROR_CODES.selectedProfile,
      message: "an OpenMeld profile is required for this command",
    });
  }

  if (
    input.context.runtime.resolvedView !== "human" ||
    !input.context.allowPrompt
  ) {
    emitSelectedProfileStatus({
      context: input.context,
      blocking: true,
      profilesFound: false,
    });
    return {
      status: "blocked",
      exitCode: 1,
    };
  }

  return await promptForSelectedProfile(input.context);
}

async function promptForSelectedProfile(
  context: CommandEntryContext
): Promise<CommandEntryResult> {
  const copy = getCommandEntryCopy(context.entryName);
  const visibleProfiles = await listVisibleProfiles(context);
  showHumanCheckCard({
    presenter: context.presenter,
    codePrefix: "command.entry.selected_profile.card",
    title: "OpenMeld Profile Needed",
    status:
      visibleProfiles.length > 0
        ? "Choose an OpenMeld profile before continuing."
        : "Create an OpenMeld profile before continuing.",
    why: copy.profileAction
      ? `This command needs a profile before ${copy.profileAction}.`
      : "This command needs an OpenMeld profile.",
    next:
      visibleProfiles.length > 0
        ? "Choose an existing profile or create a new one."
        : "Create a new profile for this device.",
  });

  const selected = await select({
    message: "What do you want to do?",
    options:
      visibleProfiles.length > 0
        ? [
            {
              value: CHOOSE_PROFILE,
              label: "Choose a profile",
            },
            {
              value: CREATE_PROFILE,
              label: "Create a new profile",
            },
            {
              value: CANCEL_PROFILE,
              label: "Cancel",
            },
          ]
        : [
            {
              value: CREATE_PROFILE,
              label: "Create a new profile",
            },
            {
              value: CANCEL_PROFILE,
              label: "Cancel",
            },
          ],
  });

  if (isCancel(selected) || selected === CANCEL_PROFILE) {
    cancel("Cancelled.");
    return {
      status: "cancelled",
    };
  }

  if (selected === CHOOSE_PROFILE) {
    const profileId = await promptForExistingProfile({
      context,
      visibleProfiles,
      currentProfileId: null,
      message: "Choose OpenMeld profile",
    });
    if (!profileId) {
      return {
        status: "cancelled",
      };
    }
    const profile = await resolveOpenMeldProfile({
      openMeldProfileId: profileId,
    });
    const currentState = getCurrentCommandCheckState();
    currentState.selectedProfile = {
      openMeldProfileId: profile.openMeldProfileId,
      profile,
    };
    return {
      status: "continue",
    };
  }

  const created = await createProfileFromEntryFlow(context);
  if (!created) {
    return {
      status: "cancelled",
    };
  }
  const currentState = getCurrentCommandCheckState();
  currentState.selectedProfile = {
    openMeldProfileId: created.openMeldProfileId,
    profile: created,
  };
  return {
    status: "continue",
  };
}

async function promptForExistingProfile(input: {
  context: CommandEntryContext;
  visibleProfiles: OpenMeldProfile[];
  currentProfileId: string | null;
  message: string;
}): Promise<string | null> {
  const selected = await promptForOpenMeldProfileSelection({
    message: input.message,
    resolvedView: input.context.runtime.resolvedView,
    visibleProfiles: input.visibleProfiles,
    currentProfileId: input.currentProfileId,
    backLabel: "Cancel",
  });
  if (!(selected && selected.status === "submitted")) {
    cancel("Cancelled.");
    return null;
  }
  await setSelectedOpenMeldProfileId(selected.value);
  return selected.value;
}

function listVisibleProfiles(context: CommandEntryContext) {
  return listVisibleOpenMeldProfilesForView(context.runtime.resolvedView);
}

async function resolveCurrentProfileForConfirmation(input: {
  context: CommandEntryContext;
  resolvedProfile: OpenMeldProfile | null;
}): Promise<OpenMeldProfile | null> {
  if (input.resolvedProfile) {
    return input.resolvedProfile;
  }

  return await resolveOpenMeldProfileOrNull({
    allowDefaultFallback: true,
    persistSelection: false,
    allowUnauthenticated: false,
  }).catch(() => null);
}

function ensureCurrentProfileIsVisible(input: {
  visibleProfiles: OpenMeldProfile[];
  currentProfile: OpenMeldProfile | null;
}): OpenMeldProfile[] {
  if (!input.currentProfile) {
    return input.visibleProfiles;
  }

  const alreadyVisible = input.visibleProfiles.some(
    (profile) =>
      profile.openMeldProfileId === input.currentProfile?.openMeldProfileId
  );
  if (alreadyVisible) {
    return input.visibleProfiles;
  }

  return [input.currentProfile, ...input.visibleProfiles];
}

function resolveProfileConfirmationMessage(
  entryName: CommandEntryContext["entryName"]
): string {
  return entryName === "space.join"
    ? SPACE_JOIN_PROFILE_SELECTION_MESSAGE
    : SPACE_COMMAND_PROFILE_SELECTION_MESSAGE;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function createProfileFromEntryFlow(context: CommandEntryContext) {
  while (true) {
    const profileKind = await resolveProfileKindForEntryFlow(context);
    if (!profileKind) {
      cancel("Cancelled.");
      return null;
    }
    const profileName = await resolveCreateProfileName({
      explicitProfileName: undefined,
      allowPrompt: true,
      resolvedView: context.runtime.resolvedView,
      profileKind,
      promptMessage: "Profile name",
      promptPlaceholder:
        profileKind === "human" ? "openmeld-ceo" : "my-codex-researcher",
      allowBack: true,
      backLabel: "Back",
    });
    if (profileName.status === "cancelled") {
      cancel("Cancelled.");
      return null;
    }
    if (profileName.status === "back") {
      continue;
    }
    const created = await createProfileByKind({
      profileName: profileName.value,
      profileKind,
    });
    await clearSelectedOpenMeldProfileId().catch(() => {
      return;
    });
    await setSelectedOpenMeldProfileId(created.openMeldProfileId);
    return created;
  }
}

async function resolveProfileKindForEntryFlow(
  context: CommandEntryContext
): Promise<CreateProfileKind | null> {
  if (context.runtime.resolvedView === "agent") {
    return "agent";
  }
  const selected = await resolveCreateProfileKind({
    explicitKind: undefined,
    allowPrompt: true,
    resolvedView: context.runtime.resolvedView,
    promptMessage: "Profile type",
    exitLabel: "Cancel",
  });
  return selected.status === "submitted" ? selected.value : null;
}

function emitSelectedProfileStatus(input: {
  context: CommandEntryContext;
  blocking: boolean;
  profilesFound: boolean;
}): void {
  if (input.context.runtime.resolvedView === "human") {
    showHumanCheckCard({
      presenter: input.context.presenter,
      codePrefix: "command.entry.selected_profile.missing.card",
      title: "OpenMeld Profile Needed",
      status: "Choose or create an OpenMeld profile.",
      why: "This command needs an OpenMeld profile on the current OpenMeld account.",
      next: input.profilesFound
        ? "Run `openmeld profile set` or `openmeld start`, then retry."
        : "Run `openmeld start` or `openmeld profile create`, then retry.",
    });
    return;
  }
  input.context.presenter.data({
    code: input.blocking
      ? "command.entry.selected_profile.blocked"
      : "command.entry.selected_profile.status",
    payload: buildAgentCheckResult({
      code: "profile.required",
      status: input.blocking ? "blocked" : "needs_attention",
      reason: "an OpenMeld profile is required for this command",
      nextSteps: formatOpenMeldCliCommands([
        "openmeld start",
        "openmeld profile list",
        "openmeld profile set <profile-id>",
      ]),
      humanActionRequired: true,
      canContinueAfterFix: true,
    }),
  });
}
