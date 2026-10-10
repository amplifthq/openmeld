import type { PostgresDatabase } from "@openmeld/db/postgresql";

export type ConversationHistoryBoundary = {
  throughPosition: number;
  deletedAt: number;
};

/** Core owns the personal read boundary; Space captures the accepted position. */
export async function readConversationHistoryBoundary(
  db: PostgresDatabase,
  spaceId: string,
  userId?: string
): Promise<ConversationHistoryBoundary | null> {
  if (!userId) {
    return null;
  }
  const result = await db.query<{
    through_position: string | number;
    deleted_at_ms: string | number;
  }>({
    text: 'SELECT through_position, deleted_at_ms FROM "openmeld"."conversation_history_deletions" WHERE space_id = $1 AND user_id = $2',
    values: [spaceId, userId],
  });
  const row = result.rows[0];
  return row
    ? {
        throughPosition: Number(row.through_position),
        deletedAt: Number(row.deleted_at_ms),
      }
    : null;
}

export async function deleteConversationHistoryForUser(
  db: PostgresDatabase,
  input: {
    spaceId: string;
    userId: string;
    throughPosition: number;
    deletedAt: number;
  }
): Promise<void> {
  await db.query({
    text: `WITH boundary AS (INSERT INTO "openmeld"."conversation_history_deletions" (space_id, user_id, through_position, deleted_at_ms)
      VALUES ($1, $2, $3, $4) ON CONFLICT (space_id, user_id) DO UPDATE SET
      through_position = GREATEST(conversation_history_deletions.through_position, EXCLUDED.through_position),
      deleted_at_ms = GREATEST(conversation_history_deletions.deleted_at_ms, EXCLUDED.deleted_at_ms) RETURNING space_id)
      UPDATE "openmeld"."inbox_items" SET cleared_at_ms = COALESCE(cleared_at_ms, $4), read_at_ms = COALESCE(read_at_ms, $4)
      WHERE recipient_user_id = $2 AND ((source_target_json)::jsonb #>> '{spaceId}') = $1 AND occurred_at_ms <= $4`,
    values: [
      input.spaceId,
      input.userId,
      input.throughPosition,
      input.deletedAt,
    ],
  });
}

export async function readConversationDeletionDates(
  db: PostgresDatabase,
  userId: string,
  spaceIds: string[]
): Promise<Map<string, number>> {
  if (!spaceIds.length) {
    return new Map();
  }
  const result = await db.query<{
    space_id: string;
    deleted_at_ms: string | number;
  }>({
    text: 'SELECT space_id, deleted_at_ms FROM "openmeld"."conversation_history_deletions" WHERE user_id = $1 AND space_id = ANY($2::text[])',
    values: [userId, spaceIds],
  });
  return new Map(
    result.rows.map((row) => [row.space_id, Number(row.deleted_at_ms)])
  );
}
