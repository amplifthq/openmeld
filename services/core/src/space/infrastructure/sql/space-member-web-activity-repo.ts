// Foreground Web visits are independent of socket entry and message read cursors.
export function readSpaceMemberHumanTextActivity(
  sql: SqlStorage,
  profileId: string
): string | null {
  const row = sql
    .exec<{ last_active_at: number | null }>(
      "SELECT MAX(ts) AS last_active_at FROM space_signals WHERE type = 'signal.text' AND profile_id = ?",
      profileId
    )
    .toArray()[0];
  return row?.last_active_at != null
    ? new Date(row.last_active_at).toISOString()
    : null;
}

export function readSpaceMemberWebActivity(
  sql: SqlStorage,
  profileId: string
): string | null {
  const row = sql
    .exec<{ last_active_at: number }>(
      "SELECT last_active_at FROM space_member_web_activity WHERE profile_id = ?",
      profileId
    )
    .toArray()[0];
  return row ? new Date(row.last_active_at).toISOString() : null;
}

export function recordSpaceMemberWebActivity(
  sql: SqlStorage,
  profileId: string,
  lastActiveAt: string
): void {
  sql.exec(
    `INSERT INTO space_member_web_activity (profile_id, last_active_at) VALUES (?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET last_active_at = MAX(last_active_at, excluded.last_active_at)`,
    profileId,
    Date.parse(lastActiveAt)
  );
}
