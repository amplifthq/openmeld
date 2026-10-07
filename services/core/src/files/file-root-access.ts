import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type {
  CenterAgentVerifiedMemberToolSpeaker,
  OpenMeldRequestContext,
  SpaceFileActor,
} from "@openmeld/schemas/types";
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import type { CoreBindings } from "../lib/bindings";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import type { OrganizationFileRoot } from "./file-root-identity";
/** Recheck a member's current membership or the designated Center identity. */
export async function prepareOrganizationFileRootAccess(input: {
  context: OpenMeldRequestContext;
  env: CoreBindings;
  root: OrganizationFileRoot;
  speakerMember?: CenterAgentVerifiedMemberToolSpeaker;
}): Promise<{
  actor: SpaceFileActor;
}> {
  const { context, env, root } = input;
  const { actorContext } = context;
  if (
    root.kind === "team" &&
    actorContext.profileKind === "agent" &&
    !actorContext.ownerUserId
  ) {
    if (!input.speakerMember) {
      throw createCoreRpcHttpError({
        code: "file_root.member_required",
        reason: "Team files require a verified current member.",
        status: 403,
      });
    }
    const represented = await prepareCenterAgentRepresentedMemberRequest(
      env,
      context,
      input.speakerMember
    );
    const center = represented.authorization;
    requireExpectedOrganizationContext({
      actualOrganizationId: center.activeOrganization.organizationId,
      expectedOrganizationId: root.organizationId,
      errorCode: "file_root.organization_context_changed",
    });
    return {
      actor: {
        profileId: center.actorProfileId,
        profileKind: "agent",
        displayName: center.actorProfile.profileName,
        ownerUserId: represented.representedHuman.userId,
      },
    };
  }
  const membership = await resolveActiveOrganizationMembership({
    context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  requireExpectedOrganizationContext({
    actualOrganizationId: membership.organizationId,
    expectedOrganizationId: root.organizationId,
    errorCode: "file_root.organization_context_changed",
  });
  if (root.kind === "member" && root.memberUserId !== membership.userId) {
    throw createCoreRpcHttpError({
      code: "file_root.owner_required",
      reason: "These private files belong to another member.",
      status: 403,
    });
  }
  if (actorContext.profileKind === "system") {
    throw createCoreRpcHttpError({
      code: "file_root.profile_required",
      reason: "An active human or Agent profile is required.",
      status: 403,
    });
  }
  // A private audience needs its own conversation and runtime isolation proof.
  // HTTP requests currently carry no such proof for an Agent.
  if (root.kind === "member" && actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      code: "file_root.private_audience_required",
      reason: "Private files are not available in this Agent conversation.",
      status: 403,
    });
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "file_root.identity_unavailable",
      reason: "Files are temporarily unavailable.",
      status: 503,
    });
  }
  const activeProfile = await db
    .query({
      text: `SELECT 1 FROM "openmeld"."openmeld_profiles"
       WHERE profile_id = $1 AND owner_user_id = $2
         AND profile_kind = $3 AND status = 'active'
       LIMIT 1`,
      values: [
        actorContext.openMeldProfileId,
        membership.userId,
        actorContext.profileKind,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (!activeProfile) {
    throw createCoreRpcHttpError({
      code: "file_root.profile_required",
      reason: "Use an active profile belonging to this member.",
      status: 403,
    });
  }
  return {
    actor: {
      profileId: actorContext.openMeldProfileId,
      profileKind: actorContext.profileKind,
      displayName:
        actorContext.profileName ??
        (actorContext.profileKind === "human" ? "Member" : "Agent"),
      ownerUserId: membership.userId,
    },
  };
}
