import type { PostgresDatabase } from "@openmeld/db/postgresql";

type OrganizationMemberActivityRow = {
  human_profile_id: string;
  last_active_at_ms: number;
  organization_id: string;
  updated_at_ms: number;
  user_id: string;
};
export type OrganizationMemberActivityRecord = {
  humanProfileId: string;
  lastActiveAtMs: number;
  organizationId: string;
  updatedAtMs: number;
  userId: string;
};
export async function recordOrganizationMemberActivity(input: {
  db: PostgresDatabase;
  humanProfileId: string;
  lastActiveAtMs: number;
  organizationId: string;
  updatedAtMs: number;
  userId: string;
}): Promise<void> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."organization_member_activity" (
          organization_id,
          user_id,
          human_profile_id,
          last_active_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(organization_id, user_id) DO UPDATE SET
          human_profile_id = excluded.human_profile_id,
          last_active_at_ms = excluded.last_active_at_ms,
          updated_at_ms = excluded.updated_at_ms
        WHERE excluded.last_active_at_ms > organization_member_activity.last_active_at_ms
      `,
    values: [
      input.organizationId,
      input.userId,
      input.humanProfileId,
      input.lastActiveAtMs,
      input.updatedAtMs,
    ],
  });
}
export async function listOrganizationMemberActivity(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<OrganizationMemberActivityRecord[]> {
  const result = await input.db.query<OrganizationMemberActivityRow>({
    text: `
        SELECT
          organization_id,
          user_id,
          human_profile_id,
          last_active_at_ms,
          updated_at_ms
        FROM "openmeld"."organization_member_activity"
        WHERE organization_id = $1
        ORDER BY user_id ASC NULLS FIRST
      `,
    values: [input.organizationId],
  });
  return result.rows.map((row) => mapOrganizationMemberActivityRow(row));
}
function mapOrganizationMemberActivityRow(
  row: OrganizationMemberActivityRow
): OrganizationMemberActivityRecord {
  if (!(row.organization_id && row.user_id && row.human_profile_id)) {
    throw new Error("Invalid Organization member activity projection row.");
  }
  if (
    !Number.isSafeInteger(row.last_active_at_ms) ||
    row.last_active_at_ms < 0 ||
    !Number.isSafeInteger(row.updated_at_ms) ||
    row.updated_at_ms < row.last_active_at_ms
  ) {
    throw new Error("Invalid Organization member activity projection row.");
  }
  return {
    humanProfileId: row.human_profile_id,
    lastActiveAtMs: row.last_active_at_ms,
    organizationId: row.organization_id,
    updatedAtMs: row.updated_at_ms,
    userId: row.user_id,
  };
}
