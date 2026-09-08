import { sanitizeSignalTextPreview } from "@openmeld/schemas";
import type { AccountSpaceIndexItem } from "@openmeld/schemas/types";
import { parseStoredSignal } from "../space/rules/parsers/stored-signal";

export type SpaceMessagePreview = Exclude<
  AccountSpaceIndexItem["messagePreview"],
  undefined
>;

export function captureSpaceMessagePreview(sql: SqlStorage): {
  revision: number;
  preview: SpaceMessagePreview;
} {
  const row = sql
    .exec<{
      storage_order: number;
      id: string;
      ts: number;
      profile_id: string;
      payload_json: string;
    }>(`
    SELECT rowid AS storage_order, id, ts, profile_id, payload_json
    FROM space_signals WHERE type = 'signal.text'
    ORDER BY ts DESC, id DESC LIMIT 1
  `)
    .toArray()[0];
  const signal = row ? parseStoredSignal(row.payload_json) : null;
  // A durable counter also orders retention snapshots after their deleted messages.
  const revision = sql
    .exec<{ revision: number }>(
      `INSERT INTO space_message_preview_revision (singleton, revision) VALUES (1, 1)
         ON CONFLICT(singleton) DO UPDATE SET revision = revision + 1 RETURNING revision`
    )
    .toArray()[0]?.revision;
  if (revision === undefined) {
    throw new Error("Message preview revision was not persisted");
  }
  return {
    revision,
    preview:
      signal?.type === "signal.text"
        ? {
            signalId: signal.id,
            profileId: signal.profile.profileId,
            timestamp: signal.ts,
            text: (
              sanitizeSignalTextPreview(signal.data.text) ?? "Message"
            ).slice(0, 240),
          }
        : null,
  };
}

export async function projectSpaceMessagePreview(input: {
  db: D1Database;
  spaceId: string;
  revision: number;
  preview: SpaceMessagePreview;
}): Promise<void> {
  const result = await input.db
    .prepare(`
    UPDATE space_index_spaces SET message_preview_revision = ?, message_preview_json = ?
    WHERE space_id = ? AND status = 'active' AND (message_preview_revision IS NULL OR message_preview_revision <= ?)
  `)
    .bind(
      input.revision,
      input.preview === null ? null : JSON.stringify(input.preview),
      input.spaceId,
      input.revision
    )
    .run();
  if (result.meta.changes > 0) {
    return;
  }
  // A failed creation projection must not turn a no-op into a completed preview.
  const row = await input.db
    .prepare("SELECT space_id FROM space_index_spaces WHERE space_id = ?")
    .bind(input.spaceId)
    .first();
  if (!row) {
    throw new Error("Space index must exist before its message preview");
  }
}
