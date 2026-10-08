import type { PostgresDatabase } from "@openmeld/db/postgresql";
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
  input: SlackThreadContextCursorKey & {
    db: PostgresDatabase;
  }
): Promise<string | null> {
  const row = await input.db
    .query<SlackThreadContextCursorRow>({
      text: `
        SELECT synced_through_ts
        FROM "openmeld"."openMeldRemoteAgent_slack_thread_context_cursors"
        WHERE organization_id = $1
          AND slack_team_id = $2
          AND slack_channel_id = $3
          AND slack_thread_ts = $4
          AND connection_created_at_ms = $5
        LIMIT 1
      `,
      values: [
        input.organizationId,
        input.slackTeamId,
        input.slackChannelId,
        input.slackThreadTs,
        input.connectionCreatedAtMs,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row?.synced_through_ts ?? null;
}
export async function advanceSlackThreadContextCursor(
  input: SlackThreadContextCursorKey & {
    db: PostgresDatabase;
    nowMs: number;
    syncedThroughEpochMicros: number;
    syncedThroughTs: string;
  }
): Promise<void> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_slack_thread_context_cursors" (
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
          "openMeldRemoteAgent_slack_thread_context_cursors".synced_through_epoch_micros
      `,
    values: [
      input.organizationId,
      input.slackTeamId,
      input.slackChannelId,
      input.slackThreadTs,
      input.connectionCreatedAtMs,
      input.syncedThroughTs,
      input.syncedThroughEpochMicros,
      input.nowMs,
      input.nowMs,
    ],
  });
}
