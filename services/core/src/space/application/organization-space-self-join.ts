import type {
  OpenMeldRequestContext,
  ResolvedSpaceMemberProfile,
} from "@openmeld/schemas/types";
import { resolveSpaceAccess } from "@openmeld/space";
import {
  resolveSpaceMetaLinkJoinPolicy,
  type SpaceMetaRecord,
} from "../infrastructure/sql/space-meta-repo";

export function resolveHumanSpaceSelfJoinUserId(input: {
  context: OpenMeldRequestContext;
  members: readonly ResolvedSpaceMemberProfile[];
}): string | null {
  const actor = input.context.actorContext;
  const member = input.members[0];
  if (
    actor.profileKind !== "human" ||
    !actor.callerPrincipalId ||
    actor.callerPrincipalId !== actor.ownerUserId ||
    input.members.length !== 1 ||
    member?.profileKind !== "human" ||
    member.profileId !== actor.openMeldProfileId ||
    member.ownerUserId !== actor.callerPrincipalId
  ) {
    return null;
  }
  return actor.callerPrincipalId;
}

export function allowsExternalSpaceLinkJoin(meta: SpaceMetaRecord): boolean {
  return (
    meta.allowGuests === true &&
    meta.accessMode !== "members_only" &&
    resolveSpaceMetaLinkJoinPolicy(meta) !== "invite_only" &&
    !(meta.directMessage && !meta.directMessage.convertedAt)
  );
}

/** The ordinary Organization join grant admits only the caller's own Human. */
export function resolveOrganizationSpaceSelfJoinUserId(input: {
  context: OpenMeldRequestContext;
  members: readonly ResolvedSpaceMemberProfile[];
  meta: SpaceMetaRecord;
}): string | null {
  if (
    !resolveSpaceAccess({
      visibility: input.meta.visibility,
      accessMode: "members_only",
      organizationMember: true,
      activeMember: false,
      password: "missing",
    }).canJoin ||
    (input.meta.directMessage && !input.meta.directMessage.convertedAt)
  ) {
    return null;
  }
  return resolveHumanSpaceSelfJoinUserId(input);
}
