import type {
  OpenMeldRequestContext,
  SpaceFileActor,
} from "@openmeld/schemas/types";
import { type CoreBindings, identityDb } from "../lib/bindings";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import type { OrganizationFileRoot } from "./file-root-identity";

/** Recheck the represented person's current membership before every root operation. */
export async function prepareOrganizationFileRootAccess(input: {
  context: OpenMeldRequestContext;
  env: CoreBindings;
  root: OrganizationFileRoot;
}): Promise<{ actor: SpaceFileActor; userId: string }> {
  const { context, env, root } = input;
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
  const { actorContext } = context;
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
  const db = identityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "file_root.identity_unavailable",
      reason: "Files are temporarily unavailable.",
      status: 503,
    });
  }
  const activeProfile = await db
    .prepare(
      `SELECT 1 FROM openmeld_profiles
       WHERE profile_id = ? AND owner_user_id = ?
         AND profile_kind = ? AND status = 'active'
       LIMIT 1`
    )
    .bind(
      actorContext.openMeldProfileId,
      membership.userId,
      actorContext.profileKind
    )
    .first();
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
    userId: membership.userId,
  };
}
