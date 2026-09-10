import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { isSpaceOwner } from "../access/space-ownership";

export type SpaceDeleteActionVisibilityReason =
  | "space_owner"
  | "members_unavailable"
  | "not_space_owner";

export type SpaceDeleteActionVisibility = {
  reason: SpaceDeleteActionVisibilityReason;
  visible: boolean;
};

export function resolveSpaceDeleteActionVisibility(input: {
  currentProfileId: string;
  membersSnapshot: SpaceMembersSnapshot | null | undefined;
  ownerUserIds?: readonly string[];
}): SpaceDeleteActionVisibility {
  if (!input.membersSnapshot) {
    return { reason: "members_unavailable", visible: false };
  }
  const member = input.membersSnapshot.humans.find(
    (person) =>
      person.profileId === input.currentProfileId && person.status === "active"
  );
  const visible = isSpaceOwner({
    ownerUserIds: input.ownerUserIds ?? [],
    actorOwnerUserId: member?.ownerUserId,
    actorKind: member?.profileKind,
  });
  return { reason: visible ? "space_owner" : "not_space_owner", visible };
}
