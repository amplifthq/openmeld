import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  MutateSpaceInboxReadBody,
  MutateSpaceInboxReadResponse,
} from "@openmeld/schemas/types";
import { INBOX_SPACE_MESSAGE_FILTER, InboxServiceError } from "./inbox-service";
import { buildCurrentInboxSourceAccessSql } from "./inbox-source-access";
// The same recipient Inbox rows own both visible-message reads and explicit
// Space-wide reads. Snapshots freeze selection only; they are not a read ledger.
export async function mutateSpaceInboxRead(input: {
  db: PostgresDatabase;
  organizationId: string;
  recipientUserId: string;
  body: MutateSpaceInboxReadBody;
  nowMs?: number;
}): Promise<MutateSpaceInboxReadResponse> {
  const { db, body, organizationId, recipientUserId } = input;
  const now = input.nowMs ?? Date.now();
  const filter = (
    parameterOffset: number
  ) => `organization_id = $${parameterOffset + 1} AND recipient_user_id = $${parameterOffset + 2}
    AND read_at_ms IS NULL
    AND ${INBOX_SPACE_MESSAGE_FILTER}
    AND ((source_target_json)::jsonb #>> '{spaceId}') = $${parameterOffset + 3}
    AND ${buildCurrentInboxSourceAccessSql("inbox_items")}`;
  const scope = [organizationId, recipientUserId, body.spaceId];
  if (body.operation === "prepare") {
    const snapshotId = crypto.randomUUID();
    await db.transaction(
      async (client) =>
        [
          await client.query({
            text: 'DELETE FROM "openmeld"."inbox_feed_snapshots" WHERE id IN (SELECT id FROM "openmeld"."inbox_feed_snapshots" WHERE expires_at_ms <= $1 LIMIT 100)',
            values: [now],
          }),
          await client.query({
            text: `INSERT INTO "openmeld"."inbox_feed_snapshots"
        (id, organization_id, recipient_user_id, category, unread_only, agents_only, through_row_id, created_at_ms, expires_at_ms)
        SELECT $1, $2, $3, 'all', 1, 0, coalesce(max(sequence), 0), $4, $5 FROM "openmeld"."inbox_items"`,
            values: [
              snapshotId,
              organizationId,
              recipientUserId,
              now,
              now + 15 * 60 * 1000,
            ],
          }),
          await client.query({
            text: `INSERT INTO "openmeld"."inbox_feed_snapshot_members" (snapshot_id, item_id)
        SELECT $1, id FROM "openmeld"."inbox_items" WHERE ${filter(1)}`,
            values: [snapshotId, ...scope],
          }),
        ] as const
    );
    const count = await db
      .query<{
        count: number;
      }>({
        text: 'SELECT count(*) AS count FROM "openmeld"."inbox_feed_snapshot_members" WHERE snapshot_id = $1',
        values: [snapshotId],
      })
      .then((result) => result.rows[0] ?? null);
    return { operation: "prepare", snapshotId, unreadCount: count?.count ?? 0 };
  }
  if (body.operation === "clear") {
    const snapshot = await db
      .query({
        text: `SELECT id FROM "openmeld"."inbox_feed_snapshots"
      WHERE id = $1 AND organization_id = $2 AND recipient_user_id = $3 AND expires_at_ms > $4`,
        values: [body.snapshotId, organizationId, recipientUserId, now],
      })
      .then((result) => result.rows[0] ?? null);
    if (!snapshot) {
      throw new InboxServiceError({
        code: "inbox.snapshot_expired",
        status: 409,
        message: "This selection has expired. Close this dialog and try again.",
      });
    }
  }
  const selection =
    body.operation === "clear"
      ? `id IN (SELECT item_id FROM "openmeld"."inbox_feed_snapshot_members" WHERE snapshot_id = $6)
 AND updated_at_ms <= (SELECT created_at_ms FROM "openmeld"."inbox_feed_snapshots" WHERE id = $7)`
      : `EXISTS (SELECT 1 FROM jsonb_array_elements_text($6::jsonb) AS selected(value)
        WHERE ((selected.value)::jsonb #>> '{itemId}') = inbox_items.id
          AND ((selected.value)::jsonb #>> '{occurredAtMs}')::bigint = inbox_items.occurred_at_ms)`;
  const result = await db.query({
    text: `UPDATE "openmeld"."inbox_items"
    SET read_at_ms = GREATEST($1, created_at_ms), updated_at_ms = GREATEST($2, updated_at_ms)
    WHERE ${filter(2)} AND ${selection}`,
    values: [
      now,
      now,
      ...scope,
      ...(body.operation === "clear"
        ? [body.snapshotId, body.snapshotId]
        : [JSON.stringify(body.items)]),
    ],
  });
  return {
    operation: "read",
    markedReadCount: Math.max(0, Number(result.rowCount ?? 0)),
  };
}
