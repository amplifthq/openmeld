import type {
  MutateSpaceInboxReadBody,
  MutateSpaceInboxReadResponse,
} from "@openmeld/schemas/types";
import { INBOX_SPACE_MESSAGE_FILTER, InboxServiceError } from "./inbox-service";
import { buildCurrentInboxSourceAccessSql } from "./inbox-source-access";

// The same recipient Inbox rows own both visible-message reads and explicit
// Space-wide reads. Snapshots freeze selection only; they are not a read ledger.
export async function mutateSpaceInboxRead(input: {
  db: D1Database;
  organizationId: string;
  recipientUserId: string;
  body: MutateSpaceInboxReadBody;
  nowMs?: number;
}): Promise<MutateSpaceInboxReadResponse> {
  const { db, body, organizationId, recipientUserId } = input;
  const now = input.nowMs ?? Date.now();
  const filter = `organization_id = ? AND recipient_user_id = ?
    AND cleared_at_ms IS NULL AND read_at_ms IS NULL
    AND ${INBOX_SPACE_MESSAGE_FILTER}
    AND json_extract(source_target_json, '$.spaceId') = ?
    AND ${buildCurrentInboxSourceAccessSql("inbox_items")}`;
  const scope = [organizationId, recipientUserId, body.spaceId];

  if (body.operation === "prepare") {
    const snapshotId = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "DELETE FROM inbox_feed_snapshots WHERE id IN (SELECT id FROM inbox_feed_snapshots WHERE expires_at_ms <= ? LIMIT 100)"
        )
        .bind(now),
      db
        .prepare(`INSERT INTO inbox_feed_snapshots
        (id, organization_id, recipient_user_id, category, unread_only, agents_only, through_row_id, created_at_ms, expires_at_ms)
        SELECT ?, ?, ?, 'all', 1, 0, coalesce(max(rowid), 0), ?, ? FROM inbox_items`)
        .bind(
          snapshotId,
          organizationId,
          recipientUserId,
          now,
          now + 15 * 60 * 1000
        ),
      db
        .prepare(`INSERT INTO inbox_feed_snapshot_members (snapshot_id, item_id)
        SELECT ?, id FROM inbox_items WHERE ${filter}`)
        .bind(snapshotId, ...scope),
    ]);
    const count = await db
      .prepare(
        "SELECT count(*) AS count FROM inbox_feed_snapshot_members WHERE snapshot_id = ?"
      )
      .bind(snapshotId)
      .first<{ count: number }>();
    return { operation: "prepare", snapshotId, unreadCount: count?.count ?? 0 };
  }

  if (body.operation === "clear") {
    const snapshot = await db
      .prepare(`SELECT id FROM inbox_feed_snapshots
      WHERE id = ? AND organization_id = ? AND recipient_user_id = ? AND expires_at_ms > ?`)
      .bind(body.snapshotId, organizationId, recipientUserId, now)
      .first();
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
      ? `id IN (SELECT item_id FROM inbox_feed_snapshot_members WHERE snapshot_id = ?)
 AND updated_at_ms <= (SELECT created_at_ms FROM inbox_feed_snapshots WHERE id = ?)`
      : `EXISTS (SELECT 1 FROM json_each(?) AS selected
        WHERE json_extract(selected.value, '$.itemId') = inbox_items.id
          AND json_extract(selected.value, '$.occurredAtMs') = inbox_items.occurred_at_ms)`;
  const result = await db
    .prepare(`UPDATE inbox_items
    SET read_at_ms = max(?, created_at_ms), updated_at_ms = max(?, updated_at_ms)
    WHERE ${filter} AND ${selection}`)
    .bind(
      now,
      now,
      ...scope,
      ...(body.operation === "clear"
        ? [body.snapshotId, body.snapshotId]
        : [JSON.stringify(body.items)])
    )
    .run();
  return {
    operation: "read",
    markedReadCount: Math.max(0, Number(result.meta.changes ?? 0)),
  };
}
