/** Group the complete main timeline in SQL; only hydrate at most 48 excerpts. */
export function readSpaceHistoryNavigationGroups(
  sql: SqlStorage,
  input: {
    startSignalId?: string;
    endSignalId?: string;
  }
) {
  return sql
    .exec<{
      signal_id: string;
      end_signal_id: string;
      start_at: number;
      end_at: number;
      count: number;
      payload_json: string;
    }>(
      `
    WITH eligible AS (
      SELECT s.rowid AS position, s.id, s.ts
      FROM space_signals s
      LEFT JOIN space_thread_signal_placements p ON p.signal_id = s.id
      WHERE s.type IN ('signal.text', 'signal.status', 'signal.system_notice')
        AND NOT (s.profile_kind = 'system' AND COALESCE(json_extract(s.payload_json, '$.data.meta.purpose'), '') = 'space_message_changed')
        AND (p.placement IS NULL OR p.placement != 'thread')
        AND (? IS NULL OR s.rowid >= (SELECT rowid FROM space_signals WHERE id = ?))
        AND (? IS NULL OR s.rowid <= (SELECT rowid FROM space_signals WHERE id = ?))
    ), ranked AS (
      SELECT *, NTILE(48) OVER (ORDER BY position) AS bucket FROM eligible
    ), groups AS (
      SELECT MIN(position) AS first, MAX(position) AS last, COUNT(*) AS count
      FROM ranked GROUP BY bucket
    )
    SELECT first.id AS signal_id, last.id AS end_signal_id,
      first.ts AS start_at, last.ts AS end_at, groups.count, first.payload_json
    FROM groups
    JOIN space_signals first ON first.rowid = groups.first
    JOIN space_signals last ON last.rowid = groups.last
    ORDER BY groups.first
  `,
      input.startSignalId ?? null,
      input.startSignalId ?? null,
      input.endSignalId ?? null,
      input.endSignalId ?? null
    )
    .toArray();
}
