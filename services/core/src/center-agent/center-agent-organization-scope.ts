export type AgentProfileOrganizationContext = {
  managedRole: string | null;
  organizationId: string | null;
  profileKind: "human" | "agent" | "system";
  profileName: string;
};

export function isAgentProfileEligibleForOrganization(input: {
  managedRole: string | null;
  profileOrganizationId: string | null;
  targetOrganizationId: string;
}): boolean {
  return (
    input.managedRole !== "center_agent" ||
    input.profileOrganizationId === input.targetOrganizationId
  );
}

export async function readAgentProfileOrganizationContext(input: {
  agentProfileId: string;
  db: D1Database;
}): Promise<AgentProfileOrganizationContext | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          organization_id,
          profile_kind,
          profile_name,
          managed_role
        FROM openmeld_profiles
        WHERE profile_id = ?
        LIMIT 1
      `
    )
    .bind(input.agentProfileId)
    .first<{
      managed_role: string | null;
      organization_id: string | null;
      profile_kind: "human" | "agent" | "system";
      profile_name: string;
    }>();
  if (!row) {
    return null;
  }
  return {
    managedRole: normalizeNullableText(row.managed_role),
    organizationId: normalizeNullableText(row.organization_id),
    profileKind: row.profile_kind,
    profileName: row.profile_name,
  };
}

function normalizeNullableText(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
