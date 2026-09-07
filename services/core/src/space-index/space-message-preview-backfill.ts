import { type CoreBindings, projectionsDb } from "../lib/bindings";
import { resolveSpaceStub } from "../rpc/space-ref";

/** Bounded repair outside the list request. Failed Spaces rotate behind untried ones. */
export async function backfillSpaceMessagePreviews(
  env: CoreBindings,
  nowMs: number
): Promise<void> {
  const db = projectionsDb(env);
  if (!db) {
    return;
  }
  const rows = await db
    .prepare(`SELECT space_id FROM space_index_spaces
    WHERE status = 'active' AND message_preview_revision IS NULL
    AND (message_preview_attempted_at_ms IS NULL OR message_preview_attempted_at_ms < ?)
    ORDER BY message_preview_attempted_at_ms, space_id LIMIT 10`)
    .bind(nowMs - 300_000)
    .all<{ space_id: string }>();
  for (const { space_id: spaceId } of rows.results) {
    await db
      .prepare(
        "UPDATE space_index_spaces SET message_preview_attempted_at_ms = ? WHERE space_id = ?"
      )
      .bind(nowMs, spaceId)
      .run();
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
