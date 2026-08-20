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
  db: D1Database;
  humanProfileId: string;
  lastActiveAtMs: number;
  organizationId: string;
  updatedAtMs: number;
  userId: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        INSERT INTO organization_member_activity (
          organization_id,
          user_id,
          human_profile_id,
          last_active_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, user_id) DO UPDATE SET
          human_profile_id = excluded.human_profile_id,
          last_active_at_ms = excluded.last_active_at_ms,
          updated_at_ms = excluded.updated_at_ms
        WHERE excluded.last_active_at_ms > organization_member_activity.last_active_at_ms
      `
    )
    .bind(
      input.organizationId,
      input.userId,
      input.humanProfileId,
      input.lastActiveAtMs,
      input.updatedAtMs
    )
    .run();
}

export async function listOrganizationMemberActivity(input: {
  db: D1Database;
  organizationId: string;
}): Promise<OrganizationMemberActivityRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
          organization_id,
          user_id,
          human_profile_id,
          last_active_at_ms,
          updated_at_ms
        FROM organization_member_activity
        WHERE organization_id = ?
        ORDER BY user_id ASC
      `
    )
    .bind(input.organizationId)
    .all<OrganizationMemberActivityRow>();

  return result.results.map((row) => mapOrganizationMemberActivityRow(row));
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
