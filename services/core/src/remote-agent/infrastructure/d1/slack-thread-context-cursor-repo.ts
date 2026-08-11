export type SlackThreadContextCursorKey = {
  connectionCreatedAtMs: number;
  organizationId: string;
  slackChannelId: string;
  slackTeamId: string;
  slackThreadTs: string;
};

type SlackThreadContextCursorRow = {
  synced_through_ts: string;
};

export async function readSlackThreadContextCursor(
  input: SlackThreadContextCursorKey & { db: D1Database }
): Promise<string | null> {
  const row = await input.db
    .prepare(
      `
        SELECT synced_through_ts
        FROM openMeldRemoteAgent_slack_thread_context_cursors
        WHERE organization_id = ?
          AND slack_team_id = ?
          AND slack_channel_id = ?
          AND slack_thread_ts = ?
          AND connection_created_at_ms = ?
        LIMIT 1
      `
    )
    .bind(
      input.organizationId,
      input.slackTeamId,
      input.slackChannelId,
      input.slackThreadTs,
      input.connectionCreatedAtMs
    )
    .first<SlackThreadContextCursorRow>();
  return row?.synced_through_ts ?? null;
}

export async function advanceSlackThreadContextCursor(
  input: SlackThreadContextCursorKey & {
    db: D1Database;
    nowMs: number;
    syncedThroughEpochMicros: number;
    syncedThroughTs: string;
  }
): Promise<void> {
  await input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_slack_thread_context_cursors (
          organization_id,
          slack_team_id,
          slack_channel_id,
          slack_thread_ts,
          connection_created_at_ms,
          synced_through_ts,
          synced_through_epoch_micros,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (
          organization_id,
          slack_team_id,
          slack_channel_id,
          slack_thread_ts,
          connection_created_at_ms
        ) DO UPDATE SET
          synced_through_ts = excluded.synced_through_ts,
          synced_through_epoch_micros = excluded.synced_through_epoch_micros,
          updated_at_ms = excluded.updated_at_ms
        WHERE excluded.synced_through_epoch_micros >
          openMeldRemoteAgent_slack_thread_context_cursors.synced_through_epoch_micros
      `
    )
    .bind(
      input.organizationId,
      input.slackTeamId,
      input.slackChannelId,
      input.slackThreadTs,
      input.connectionCreatedAtMs,
      input.syncedThroughTs,
      input.syncedThroughEpochMicros,
      input.nowMs,
      input.nowMs
    )
    .run();
}
