import type { PostgresDatabase } from "@openmeld/db/postgresql";
export type AgentProfileOrganizationContext = {
  managedRole: string | null;
  organizationId: string | null;
  ownerUserId: string | null;
  profileKind: "human" | "agent" | "system";
  profileName: string;
};
export function isAgentProfileEligibleForOrganization(input: {
  managedRole: string | null;
  profileOrganizationId: string | null;
  targetOrganizationId: string;
}): boolean {
  return input.profileOrganizationId === input.targetOrganizationId;
}
export async function readAgentProfileOrganizationContext(input: {
  agentProfileId: string;
  db: PostgresDatabase;
}): Promise<AgentProfileOrganizationContext | null> {
  const statement = {
    text: `
        SELECT
          organization_id,
          owner_user_id,
          profile_kind,
          profile_name,
          managed_role
        FROM "openmeld"."openmeld_profiles"
        WHERE profile_id = $1
        LIMIT 1
      `,
    values: [input.agentProfileId],
  };
  type Row = {
    managed_role: string | null;
    organization_id: string | null;
    owner_user_id: string | null;
    profile_kind: "human" | "agent" | "system";
    profile_name: string;
  };
  const row = await input.db
    .query<Row>(statement)
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    return null;
  }
  const ownerUserId = normalizeNullableText(row.owner_user_id);
  if (
    !(
      ownerUserId ||
      (row.managed_role === "center_agent" && row.organization_id)
    )
  ) {
    return null;
  }
  return {
    managedRole: normalizeNullableText(row.managed_role),
    organizationId: normalizeNullableText(row.organization_id),
    ownerUserId,
    profileKind: row.profile_kind,
    profileName: row.profile_name,
  };
}
function normalizeNullableText(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
