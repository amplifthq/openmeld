import { APIError } from "better-auth";

const CENTER_AGENT_HOST_REMOVAL_BLOCKED = {
  code: "organization.center_agent_host_removal_blocked",
  message:
    "This member activated the organization's Center Agent. Revoke or re-designate the Center Agent before removing them.",
} as const;

const CENTER_AGENT_HOST_GUARD_FAILED = {
  code: "organization.center_agent_host_guard_failed",
  message:
    "OpenMeld couldn't verify that this member can be removed. The member was not removed.",
} as const;

type CenterAgentHostRow = {
  agent_profile_id: string;
  owner_user_id: string | null;
};

export async function assertMemberDoesNotHostCenterAgent(input: {
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

  let host: CenterAgentHostRow | null;
  try {
    host = await input.db
      .prepare(
        `
          SELECT
            designations.agent_profile_id,
            profiles.owner_user_id
          FROM center_agent_designations AS designations
          LEFT JOIN openmeld_profiles AS profiles
            ON profiles.profile_id = designations.agent_profile_id
          WHERE designations.organization_id = ?
          LIMIT 1
        `
      )
      .bind(input.organizationId)
      .first<CenterAgentHostRow>();
  } catch (error) {
    failClosed({
      error,
      organizationId: input.organizationId,
      reason: "center_agent_host_query_failed",
      userId: input.userId,
    });
  }

  if (!host) {
    return;
  }
  if (!host.owner_user_id) {
    failClosed({
      organizationId: input.organizationId,
      reason: "center_agent_host_profile_missing",
      userId: input.userId,
    });
  }
  if (host.owner_user_id === input.userId) {
    throw new APIError("BAD_REQUEST", CENTER_AGENT_HOST_REMOVAL_BLOCKED);
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
  throw new APIError("SERVICE_UNAVAILABLE", CENTER_AGENT_HOST_GUARD_FAILED);
}
