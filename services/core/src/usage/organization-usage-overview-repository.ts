export async function readOrganizationDailyAdmissionCount(input: {
  dayUtc: string;
  db: D1Database;
  organizationId: string;
}): Promise<number> {
  const row = await input.db
    .prepare(
      `
        SELECT admitted_count
        FROM openMeldRemoteAgent_daily_admissions
        WHERE organization_id = ? AND day_utc = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.dayUtc)
    .first<{ admitted_count: number }>();

  return Number(row?.admitted_count ?? 0);
}
