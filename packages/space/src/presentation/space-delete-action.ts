import type {
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";

type SpaceMemberSnapshot = SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot;

export type SpaceDeleteActionVisibilityReason =
  | "agent_creator_owner_human_profile"
  | "creator_missing"
  | "current_profile_missing"
  | "human_creator_profile"
  | "members_unavailable"
  | "not_creator_or_owner";

export type SpaceDeleteActionVisibility = {
  reason: SpaceDeleteActionVisibilityReason;
  visible: boolean;
};

export function resolveSpaceDeleteActionVisibility(input: {
  currentProfileId: string;
  membersSnapshot: SpaceMembersSnapshot | null | undefined;
}): SpaceDeleteActionVisibility {
  const currentProfileId = normalizeOptionalText(input.currentProfileId);
  if (!(currentProfileId && input.membersSnapshot)) {
    return { reason: "members_unavailable", visible: false };
  }

  const members = listActiveMembers(input.membersSnapshot);
  const creatorMember = members.find(
    (member) => member.memberSource === "space_creator"
  );
  if (!creatorMember) {
    return { reason: "creator_missing", visible: false };
  }

  const currentMember = members.find(
    (member) => member.profileId === currentProfileId
  );
  if (!currentMember) {
    return { reason: "current_profile_missing", visible: false };
  }

  if (creatorMember.profileKind === "human") {
    return creatorMember.profileId === currentProfileId
      ? { reason: "human_creator_profile", visible: true }
      : { reason: "not_creator_or_owner", visible: false };
  }

  const creatorOwnerUserId = normalizeOptionalText(creatorMember.ownerUserId);
  const currentOwnerUserId =
    currentMember.profileKind === "human"
      ? normalizeOptionalText(currentMember.ownerUserId)
      : null;

  if (creatorOwnerUserId && currentOwnerUserId === creatorOwnerUserId) {
    return { reason: "agent_creator_owner_human_profile", visible: true };
  }

  return { reason: "not_creator_or_owner", visible: false };
}

function listActiveMembers(
  snapshot: SpaceMembersSnapshot
): SpaceMemberSnapshot[] {
  return [...snapshot.humans, ...snapshot.agents].filter(
    (member) => member.status === "active"
  );
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
