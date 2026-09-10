import { APIError } from "better-auth";

const CENTER_AGENT_MEMBER_REMOVAL_GUARD_FAILED = {
  code: "organization.center_agent_member_removal_guard_failed",
  message:
    "OpenMeld couldn't verify that this member can be removed. The member was not removed.",
} as const;

type CenterAgentIdentityRow = {
  profile_id: string | null;
  organization_id: string | null;
  profile_kind: string | null;
  managed_role: string | null;
  owner_user_id: string | null;
};

export async function assertCenterAgentIdentityBeforeMemberRemoval(input: {
  db?: D1Database;
  organizationId: string;
  userId: string;
}): Promise<void> {
  if (!input.db) {
    failClosed({
      organizationId: input.organizationId,
      reason: "openmeld_db_unbound",
      userId: input.userId,
    });
  }

  let identity: CenterAgentIdentityRow | null;
  try {
    identity = await input.db
      .prepare(
        `
          SELECT
            profiles.profile_id,
            profiles.organization_id,
            profiles.profile_kind,
            profiles.managed_role,
            profiles.owner_user_id
          FROM center_agent_designations AS designations
          LEFT JOIN openmeld_profiles AS profiles
            ON profiles.profile_id = designations.agent_profile_id
          WHERE designations.organization_id = ?
          LIMIT 1
        `
      )
      .bind(input.organizationId)
      .first<CenterAgentIdentityRow>();
  } catch (error) {
    failClosed({
      error,
      organizationId: input.organizationId,
      reason: "center_agent_identity_query_failed",
      userId: input.userId,
    });
  }

  if (!identity) {
    return;
  }
  if (!identity.profile_id) {
    failClosed({
      organizationId: input.organizationId,
      reason: "center_agent_profile_missing",
      userId: input.userId,
    });
  }
  if (
    identity.organization_id !== input.organizationId ||
    identity.profile_kind !== "agent" ||
    identity.managed_role !== "center_agent" ||
    identity.owner_user_id !== null
  ) {
    failClosed({
      organizationId: input.organizationId,
      reason: "center_agent_identity_mismatch",
      userId: input.userId,
    });
  }
}

function failClosed(input: {
  error?: unknown;
  organizationId: string;
  reason: string;
  userId: string;
}): never {
  console.error("[auth.center_agent_member_removal_guard_failed]", {
    ...(input.error
      ? {
          error:
            input.error instanceof Error
              ? input.error.message
              : String(input.error),
        }
      : {}),
    event: "auth.center_agent_member_removal_guard_failed",
    organizationId: input.organizationId,
    reason: input.reason,
    userId: input.userId,
  });
  throw new APIError(
    "SERVICE_UNAVAILABLE",
    CENTER_AGENT_MEMBER_REMOVAL_GUARD_FAILED
  );
}
