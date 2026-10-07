import type { PostgresDatabase } from "@openmeld/db/postgresql";
// Organization-managed agents never grant their administrator personal Inbox access.
// Both delivery and subsequent reads use current identity plus Space membership.
export function personalAgentOwnerAccessSql(
  spaceId: string,
  userId: string,
  exactAgentIdsJson?: string
): string {
  return `EXISTS (
    SELECT 1 FROM "openmeld"."space_index_memberships" AS owned_member
    INNER JOIN "openmeld"."openmeld_profiles" AS owned_agent
      ON owned_agent.profile_id = owned_member.profile_id
    INNER JOIN "openmeld"."space_index_spaces" AS owned_space
      ON owned_space.space_id = owned_member.space_id
      AND owned_space.organization_id = owned_agent.organization_id
      AND owned_space.status = 'active'
    LEFT JOIN "openmeld"."center_agent_designations" AS designation
      ON designation.organization_id = owned_agent.organization_id
      AND designation.agent_profile_id = owned_agent.profile_id
    WHERE owned_member.space_id = ${spaceId}
      AND owned_member.status = 'active'
      AND owned_member.profile_kind_snapshot = 'agent'
      ${exactAgentIdsJson ? `AND owned_agent.profile_id IN (SELECT value FROM jsonb_array_elements_text((${exactAgentIdsJson})::jsonb) AS agent_ids(value))` : ""}
      AND ${personalAgentIdentitySql(userId)}
  )`;
}
export async function canReceivePersonalAgentActivity(input: {
  db: PostgresDatabase;
  organizationId: string;
  agentProfileIds: readonly string[];
  userId: string;
}): Promise<boolean> {
  if (input.agentProfileIds.length === 0) {
    return false;
  }
  const row = await input.db
    .query<{
      allowed: number;
    }>({
      text: `SELECT 1 AS allowed FROM "openmeld"."openmeld_profiles" AS owned_agent
      LEFT JOIN "openmeld"."center_agent_designations" AS designation
        ON designation.organization_id = owned_agent.organization_id
        AND designation.agent_profile_id = owned_agent.profile_id
      WHERE owned_agent.organization_id = $1
        AND owned_agent.profile_id IN (SELECT value FROM jsonb_array_elements_text($2::jsonb) AS json_elements(value))
        AND ${personalAgentIdentitySql("$3")} LIMIT 1`,
      values: [
        input.organizationId,
        JSON.stringify(input.agentProfileIds),
        input.userId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row?.allowed === 1;
}
function personalAgentIdentitySql(userId: string): string {
  return `owned_agent.profile_kind = 'agent'
    AND owned_agent.owner_user_id = ${userId}
    AND owned_agent.managed_role IS NULL
    AND designation.agent_profile_id IS NULL`;
}
