/** Remove legacy personal-owner authority from Organization Agent snapshots. */
export async function reconcileOrganizationAgentOwnership(input: {
  db: D1Database;
  organizationId: string;
  sql: SqlStorage;
}): Promise<boolean> {
  let changed = false;
  const profiles = await input.db
    .prepare(`
    SELECT profile_id FROM openmeld_profiles
    WHERE organization_id = ? AND managed_role = 'center_agent'
  `)
    .bind(input.organizationId)
    .all<{ profile_id: string }>();
  for (const profile of profiles.results ?? []) {
    const members = input.sql.exec(
      `
      UPDATE space_members
      SET owner_user_id_snapshot = NULL, owner_name_snapshot = NULL
      WHERE profile_id = ? AND (owner_user_id_snapshot IS NOT NULL OR owner_name_snapshot IS NOT NULL)
    `,
      profile.profile_id
    );
    const creator = input.sql.exec(
      `
      UPDATE space_meta
      SET creator_json = json_remove(creator_json, '$.ownerUserId', '$.owner', '$.profile.owner', '$.profile.ownerUserId')
      WHERE json_extract(creator_json, '$.profileId') = ?
         OR json_extract(creator_json, '$.profile.id') = ?
    `,
      profile.profile_id,
      profile.profile_id
    );
    changed ||= members.rowsWritten > 0 || creator.rowsWritten > 0;
  }
  return changed;
}
