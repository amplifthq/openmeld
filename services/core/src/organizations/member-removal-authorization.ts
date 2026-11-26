import { memberRoleHasOrganizationPermission } from "@openmeld/auth/organization-policy";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { OrganizationMemberRemovalPreviewInput } from "@openmeld/schemas";
import { readResolvedOrganizationOwnerHumanSpaceMember } from "../center-agent/center-agent-repository";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { resolveActiveOrganizationMembership } from "./organization-context";

/** Organization administration grants handoff authority, never Space read access. */
export async function requireOrganizationMemberRemovalManager(
  env: CoreBindings,
  input: OrganizationMemberRemovalPreviewInput
) {
  const actor = input.context.actorContext;
  if (
    actor.profileKind !== "human" ||
    !actor.callerPrincipalId ||
    actor.ownerUserId !== actor.callerPrincipalId
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "organization.role_required",
      reason: "A signed-in organization owner or admin must remove members.",
    });
  }
  const membership = await resolveActiveOrganizationMembership({
    env,
    context: input.context,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      status: membership.status,
      code: membership.code,
      reason: membership.message,
    });
  }
  if (
    !memberRoleHasOrganizationPermission(membership.role, {
      member: ["delete"],
    })
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "organization.role_required",
      reason: "Only an organization owner or admin can remove members.",
    });
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw new Error("Organization membership storage is unavailable.");
  }
  const target = (
    await db.query<{ user_id: string; role: string }>({
      text: 'SELECT user_id, role FROM "openmeld"."members" WHERE id = $1 AND organization_id = $2',
      values: [input.memberId, membership.organizationId],
    })
  ).rows[0];
  if (!target) {
    throw createCoreRpcHttpError({
      status: 404,
      code: "organization.member_not_found",
      reason: "This person is no longer a member of this organization.",
    });
  }
  if (
    target.user_id === membership.userId ||
    target.role.split(",").includes("owner")
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "organization.member_removal_forbidden",
      reason:
        "Use the organization ownership or leave controls for this member.",
    });
  }
  return {
    db,
    organizationId: membership.organizationId,
    actorUserId: membership.userId,
    memberId: input.memberId,
    userId: target.user_id,
  };
}

export async function requireOrganizationMemberRemovalSuccessor(
  authorized: Awaited<
    ReturnType<typeof requireOrganizationMemberRemovalManager>
  >,
  successorUserId: string | undefined
) {
  const successor =
    successorUserId && successorUserId !== authorized.userId
      ? await readResolvedOrganizationOwnerHumanSpaceMember({
          db: authorized.db,
          organizationId: authorized.organizationId,
          ownerUserId: successorUserId,
        })
      : null;
  if (!successor?.ownerUserId) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "organization.member_removal_successor_required",
      reason:
        "Choose another current organization member with an active Human Profile to take ownership.",
    });
  }
  return { ...successor, ownerUserId: successor.ownerUserId };
}

/** An explicitly configured native membership, never a name or provider identity. */
export async function readOrganizationMemberRemovalDefaultSuccessor(
  env: CoreBindings,
  authorized: Awaited<
    ReturnType<typeof requireOrganizationMemberRemovalManager>
  >
) {
  const raw = env.OPENMELD_ORGANIZATION_MEMBER_REMOVAL_RECIPIENTS;
  if (!raw) {
    return null;
  }
  let recipients: unknown;
  try {
    recipients = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !recipients ||
    typeof recipients !== "object" ||
    Array.isArray(recipients) ||
    !Object.hasOwn(recipients, authorized.organizationId)
  ) {
    return null;
  }
  const memberId = (recipients as Record<string, unknown>)[
    authorized.organizationId
  ];
  if (typeof memberId !== "string" || !memberId || memberId.length > 255) {
    return null;
  }
  const member = (
    await authorized.db.query<{ user_id: string; role: string }>({
      text: 'SELECT user_id, role FROM "openmeld"."members" WHERE id = $1 AND organization_id = $2',
      values: [memberId, authorized.organizationId],
    })
  ).rows[0];
  if (
    !member ||
    member.user_id === authorized.userId ||
    !member.role.split(",").includes("owner")
  ) {
    return null;
  }
  const successor = await readResolvedOrganizationOwnerHumanSpaceMember({
    db: authorized.db,
    organizationId: authorized.organizationId,
    ownerUserId: member.user_id,
  });
  return successor?.ownerUserId
    ? { ...successor, ownerUserId: successor.ownerUserId }
    : null;
}

export function organizationMemberRemovalDefaultSuccessorChanged(): Error {
  return createCoreRpcHttpError({
    status: 409,
    code: "organization.member_removal_changed",
    reason:
      "The default successor changed. Review Space ownership again before removing this member.",
  });
}
