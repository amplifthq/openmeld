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
  return (
    (
      await readAgentProfileOrganizationContexts({
        db: input.db,
        agentProfileIds: [input.agentProfileId],
      })
    ).get(input.agentProfileId) ?? null
  );
}
export async function readAgentProfileOrganizationContexts(input: {
  agentProfileIds: readonly string[];
  db: PostgresDatabase;
}): Promise<Map<string, AgentProfileOrganizationContext>> {
  const contexts = new Map<string, AgentProfileOrganizationContext>();
  if (input.agentProfileIds.length === 0) {
    return contexts;
  }
  const statement = {
    text: `
        SELECT
          profile_id,
          organization_id,
          owner_user_id,
          profile_kind,
          profile_name,
          managed_role
        FROM "openmeld"."openmeld_profiles"
        WHERE profile_id = ANY($1::text[])
      `,
    values: [input.agentProfileIds],
  };
  type Row = {
    profile_id: string;
    managed_role: string | null;
    organization_id: string | null;
    owner_user_id: string | null;
    profile_kind: "human" | "agent" | "system";
    profile_name: string;
  };
  const result = await input.db.query<Row>(statement);
  for (const row of result.rows) {
    const ownerUserId = normalizeNullableText(row.owner_user_id);
    if (
      !(
        ownerUserId ||
        (row.managed_role === "center_agent" && row.organization_id)
      )
    ) {
      continue;
    }
    contexts.set(row.profile_id, {
      managedRole: normalizeNullableText(row.managed_role),
      organizationId: normalizeNullableText(row.organization_id),
      ownerUserId,
      profileKind: row.profile_kind,
      profileName: row.profile_name,
    });
  }
  return contexts;
}
function normalizeNullableText(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
