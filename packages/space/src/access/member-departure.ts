export type SpaceMemberDepartureParticipant = {
  profileId: string;
  profileKind: string | null | undefined;
  ownerUserId: string | null | undefined;
  /** Set only after verifying this Profile is the Organization's Center Agent. */
  isOrganizationCenterAgent?: boolean;
};

/** Classifies ownership handling; the Space still owns authorization and mutation. */
export function resolveSpaceMemberDeparture(input: {
  departingUserId: string;
  ownerUserIds: readonly string[] | null | undefined;
  visibility: string | null | undefined;
  accessMode: string | null | undefined;
  allowGuests: boolean | null | undefined;
  isDirectMessage: boolean | null | undefined;
  /** Include removed members: leaving a Space does not erase shared history. */
  historicalMembers:
    | readonly SpaceMemberDepartureParticipant[]
    | null
    | undefined;
}): "not_owner" | "demote" | "close" | "handoff_required" {
  if (input.isDirectMessage === true) {
    return "not_owner";
  }
  const owners = input.ownerUserIds;
  if (
    !(input.departingUserId.trim() && owners?.length) ||
    owners.some((userId) => !userId.trim())
  ) {
    return "handoff_required";
  }
  if (!owners.includes(input.departingUserId)) {
    return "not_owner";
  }
  if (owners.some((userId) => userId !== input.departingUserId)) {
    return "demote";
  }
  const members = input.historicalMembers;
  if (
    input.visibility !== "private" ||
    input.accessMode !== "members_only" ||
    input.allowGuests !== false ||
    input.isDirectMessage !== false ||
    !members?.some(
      (member) =>
        member.profileKind === "human" &&
        member.ownerUserId === input.departingUserId
    )
  ) {
    return "handoff_required";
  }
  const usedOnlyByDepartingUser = members.every((member) => {
    if (!member.profileId.trim()) {
      return false;
    }
    if (member.profileKind === "human") {
      return member.ownerUserId === input.departingUserId;
    }
    if (member.profileKind !== "agent") {
      return false;
    }
    if (member.isOrganizationCenterAgent) {
      return member.ownerUserId === null;
    }
    return member.ownerUserId === input.departingUserId;
  });
  return usedOnlyByDepartingUser ? "close" : "handoff_required";
}
