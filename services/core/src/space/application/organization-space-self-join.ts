import type {
  OpenMeldRequestContext,
  ResolvedSpaceMemberProfile,
} from "@openmeld/schemas/types";
import { resolveSpaceAccess } from "@openmeld/space";
import type { SpaceMetaRecord } from "../infrastructure/sql/space-meta-repo";

/** The ordinary Organization join grant admits only the caller's own Human. */
export function resolveOrganizationSpaceSelfJoinUserId(input: {
  context: OpenMeldRequestContext;
  members: readonly ResolvedSpaceMemberProfile[];
  meta: SpaceMetaRecord;
}): string | null {
  const actor = input.context.actorContext;
  const member = input.members[0];
  if (
    !resolveSpaceAccess({
      visibility: input.meta.visibility,
      accessMode: "members_only",
      organizationMember: true,
      activeMember: false,
      password: "missing",
    }).canJoin ||
    (input.meta.directMessage && !input.meta.directMessage.convertedAt) ||
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
