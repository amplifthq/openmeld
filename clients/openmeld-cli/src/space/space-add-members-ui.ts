import type { InfoCardRow } from "../ui/info-card";

const BRING_PROFILES_PROMPT_MESSAGE =
  "Bring your agents or other profiles with you?";
const CHOOSE_PROFILES_TO_BRING_MESSAGE =
  "Choose at least one agent or profile to bring into this space";
const JOIN_PROFILE_WORKBENCH_MESSAGE =
  "Review the profiles to bring into this space";
const CHOOSE_MEMBERS_TO_REMOVE_MESSAGE =
  "Choose at least one member to remove from this space";

export function buildBringProfilesWithYouPromptConfig() {
  return {
    message: BRING_PROFILES_PROMPT_MESSAGE,
    noOption: {
      value: "no",
      label: "No",
      hint: "Join this space on my own",
    },
    yesOption: {
      value: "yes",
      label: "Yes",
      hint: "Choose at least one human or agent profile to bring in",
    },
    backOption: {
      value: "back",
      label: "Back",
      hint: "Return to the previous step",
    },
  } as const;
}

export function getChooseProfilesToBringMessage(): string {
  return CHOOSE_PROFILES_TO_BRING_MESSAGE;
}

export function getJoinProfileWorkbenchMessage(): string {
  return JOIN_PROFILE_WORKBENCH_MESSAGE;
}

export function getChooseMembersToRemoveMessage(): string {
  return CHOOSE_MEMBERS_TO_REMOVE_MESSAGE;
}

export function buildSpaceAddMembersHumanResultCard(input: {
  added: ReadonlyArray<{
    profileName: string;
    profileKind: string;
  }>;
  alreadyJoined: ReadonlyArray<{
    profileName: string;
    profileKind: string;
  }>;
  broadcastJoinNoticeCount: number;
}): {
  title: string;
  rows: InfoCardRow[];
} {
  const rows: InfoCardRow[] = [];

  if (input.added.length > 0) {
    for (const member of input.added) {
      rows.push({
        label: "",
        value: formatAddedMemberLabel(member),
      });
    }
  } else {
    rows.push({
      label: "",
      value: "No new profiles were added.",
    });
  }

  if (input.alreadyJoined.length > 0) {
    rows.push({
      label: "",
      value: `Already here: ${input.alreadyJoined.map((member) => formatAddedMemberLabel(member)).join(", ")}`,
    });
  }

  if (input.broadcastJoinNoticeCount > 0) {
    rows.push({
      label: "",
      value: `Broadcast ${String(input.broadcastJoinNoticeCount)} join ${pluralize(input.broadcastJoinNoticeCount, "notice", "notices")}`,
    });
  }

  return {
    title:
      input.added.length > 0 ? "Added to This Space" : "Space Members Updated",
    rows,
  };
}

export function buildSpaceRemoveMembersHumanResultCard(input: {
  removed: ReadonlyArray<{
    profileName: string;
    profileKind: string;
  }>;
  alreadyAbsent: ReadonlyArray<{
    profileName: string;
    profileKind: string;
  }>;
  broadcastRemoveNoticeCount: number;
}): {
  title: string;
  rows: InfoCardRow[];
} {
  const rows: InfoCardRow[] = [];

  if (input.removed.length > 0) {
    for (const member of input.removed) {
      rows.push({
        label: "",
        value: formatAddedMemberLabel(member),
      });
    }
  } else {
    rows.push({
      label: "",
      value: "No active members were removed.",
    });
  }

  if (input.alreadyAbsent.length > 0) {
    rows.push({
      label: "",
      value: `Already absent: ${input.alreadyAbsent.map((member) => formatAddedMemberLabel(member)).join(", ")}`,
    });
  }

  if (input.broadcastRemoveNoticeCount > 0) {
    rows.push({
      label: "",
      value: `Broadcast ${String(input.broadcastRemoveNoticeCount)} removal ${pluralize(input.broadcastRemoveNoticeCount, "notice", "notices")}`,
    });
  }

  return {
    title:
      input.removed.length > 0
        ? "Removed from This Space"
        : "Space Members Updated",
    rows,
  };
}

function formatAddedMemberLabel(input: {
  profileName: string;
  profileKind: string;
}): string {
  return `${input.profileName} (${input.profileKind})`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
