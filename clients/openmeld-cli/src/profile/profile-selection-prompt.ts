import {
  listOpenMeldProfiles,
  type OpenMeldProfile,
} from "../config/openmeld-profiles-api";
import {
  isProfileKindAllowedInView,
  type SupportedCliView,
} from "../runtime/view-profile-guard";
import {
  promptSearchSelect,
  type SearchSelectResult,
} from "../ui/search-select";

export const SPACE_JOIN_PROFILE_SELECTION_MESSAGE =
  "Which profile should this join use?";
export const SPACE_COMMAND_PROFILE_SELECTION_MESSAGE =
  "Which profile should this space action use?";

export async function listVisibleOpenMeldProfilesForView(
  resolvedView: SupportedCliView
): Promise<OpenMeldProfile[]> {
  return (await listOpenMeldProfiles()).filter((profile) =>
    isProfileKindAllowedInView({
      resolvedView,
      profileKind: profile.profileKind,
    })
  );
}

export async function promptForOpenMeldProfileSelection(input: {
  message: string;
  resolvedView: SupportedCliView;
  visibleProfiles?: OpenMeldProfile[];
  currentProfileId?: string | null;
  backLabel?: string;
}): Promise<SearchSelectResult<string>> {
  const visibleProfiles =
    input.visibleProfiles ??
    (await listVisibleOpenMeldProfilesForView(input.resolvedView));
  return promptSearchSelect({
    message: input.message,
    items: buildOpenMeldProfilePromptItems({
      visibleProfiles,
      currentProfileId: input.currentProfileId ?? null,
    }),
    allowBack: true,
    backLabel: input.backLabel ?? "Cancel",
  });
}

function buildOpenMeldProfilePromptItems(input: {
  visibleProfiles: OpenMeldProfile[];
  currentProfileId: string | null;
}) {
  return moveCurrentProfileToFront(
    input.visibleProfiles,
    input.currentProfileId
  ).map((profile) => ({
    value: profile.openMeldProfileId,
    label: formatProfileSelectionLabel({
      profile,
      currentProfileId: input.currentProfileId,
    }),
    detail: formatProfileSelectionDetail(profile),
    searchText: [
      profile.profileName,
      profile.openMeldProfileId,
      profile.profileKind,
      profile.profileKind === "human" && profile.isDefault === true
        ? "main profile"
        : null,
    ]
      .filter((value): value is string => typeof value === "string")
      .join("\n"),
  }));
}

function formatProfileSelectionLabel(input: {
  profile: OpenMeldProfile;
  currentProfileId: string | null;
}): string {
  const suffixes: string[] = [];
  if (input.profile.openMeldProfileId === input.currentProfileId) {
    suffixes.push("current");
  }
  if (
    input.profile.profileKind === "human" &&
    input.profile.isDefault === true
  ) {
    suffixes.push("main");
  }
  if (suffixes.length === 0) {
    return input.profile.profileName;
  }
  return `${input.profile.profileName} (${suffixes.join(", ")})`;
}

function formatProfileSelectionDetail(profile: OpenMeldProfile): string {
  const segments = [profile.openMeldProfileId, profile.profileKind];
  if (profile.profileKind === "human" && profile.isDefault === true) {
    segments.push("main profile");
  }
  return segments.join(" · ");
}

function moveCurrentProfileToFront(
  profiles: OpenMeldProfile[],
  currentProfileId: string | null
): OpenMeldProfile[] {
  if (!currentProfileId) {
    return [...profiles];
  }

  const prioritizedProfiles: OpenMeldProfile[] = [];
  const remainingProfiles: OpenMeldProfile[] = [];

  for (const profile of profiles) {
    if (profile.openMeldProfileId === currentProfileId) {
      prioritizedProfiles.push(profile);
      continue;
    }
    remainingProfiles.push(profile);
  }

  return [...prioritizedProfiles, ...remainingProfiles];
}
