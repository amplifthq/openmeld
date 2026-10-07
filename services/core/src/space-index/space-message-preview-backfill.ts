import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { CoreBindings } from "../lib/bindings";
import { resolveSpaceStub } from "../rpc/space-ref";
/** Bounded repair outside the list request. Failed Spaces rotate behind untried ones. */
export async function backfillSpaceMessagePreviews(
  env: CoreBindings,
  nowMs: number
): Promise<void> {
  const db = getPostgresDatabase(env);
  if (!db) {
    return;
  }
  const rows = await db.query<{
    space_id: string;
  }>({
    text: `SELECT space_id FROM "openmeld"."space_index_spaces"
    WHERE status = 'active' AND (message_preview_revision IS NULL OR recent_message_previews_json IS NULL)
    AND (message_preview_attempted_at_ms IS NULL OR message_preview_attempted_at_ms < $1)
    ORDER BY message_preview_attempted_at_ms, space_id LIMIT 10`,
    values: [nowMs - 300_000],
  });
  for (const { space_id: spaceId } of rows.rows) {
    await db.query({
      text: 'UPDATE "openmeld"."space_index_spaces" SET message_preview_attempted_at_ms = $1 WHERE space_id = $2',
      values: [nowMs, spaceId],
    });
    try {
      const shard = resolveSpaceStub(env.OPENMELD_SPACES, spaceId);
      if (!shard) {
        throw new Error("Invalid Space reference");
      }
      const result = await shard.rpcReprojectSpaceIndexSnapshot({ spaceId });
      if (!result.projected) {
        throw new Error("Space projection incomplete");
      }
    } catch {
      console.warn({
        event: "core.space_message_preview.backfill_failed",
        spaceId,
      });
    }
  }
}
