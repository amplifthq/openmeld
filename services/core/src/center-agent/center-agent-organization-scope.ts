import type { D1ReadBatch } from "../lib/d1-read-batch";

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
  db: D1Database;
  readBatch?: D1ReadBatch;
}): Promise<AgentProfileOrganizationContext | null> {
  const statement = input.db
    .prepare(
      `
        SELECT
          organization_id,
          owner_user_id,
          profile_kind,
          profile_name,
          managed_role
        FROM openmeld_profiles
        WHERE profile_id = ?
        LIMIT 1
      `
    )
    .bind(input.agentProfileId);
  type Row = {
    managed_role: string | null;
    organization_id: string | null;
    owner_user_id: string | null;
    profile_kind: "human" | "agent" | "system";
    profile_name: string;
  };
  const row = input.readBatch
    ? await input.readBatch.first<Row>(input.db, statement)
    : await statement.first<Row>();
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
