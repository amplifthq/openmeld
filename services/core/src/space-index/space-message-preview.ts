import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { normalizeMessagePreview } from "@openmeld/protocol";
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
  recentPreviews: NonNullable<AccountSpaceIndexItem["recentMessagePreviews"]>;
} {
  const rows = sql
    .exec<{
      storage_order: number;
      id: string;
      ts: number;
      profile_id: string;
      payload_json: string;
    }>(`
    SELECT rowid AS storage_order, id, ts, profile_id, payload_json
    FROM space_signals WHERE type = 'signal.text'
      AND COALESCE(json_extract(payload_json, '$.data.meta.purpose'), '') != 'space_message_changed'
    ORDER BY ts DESC NULLS LAST, id DESC NULLS LAST LIMIT 2
  `)
    .toArray();
  const recentPreviews = rows.flatMap((row) => {
    const signal = parseStoredSignal(row.payload_json);
    return signal?.type === "signal.text"
      ? [
          {
            signalId: signal.id,
            profileId: signal.profile.profileId,
            timestamp: signal.ts,
            text: (
              sanitizeSignalTextPreview(
                normalizeMessagePreview(signal.data.text)
              ) ?? "Message"
            ).slice(0, 240),
          },
        ]
      : [];
  });
  // A durable counter also orders retention snapshots after their deleted messages.
  const revision = sql
    .exec<{
      revision: number;
    }>(`INSERT INTO space_message_preview_revision (singleton, revision) VALUES (1, 1)
         ON CONFLICT(singleton) DO UPDATE SET revision = revision + 1 RETURNING revision`)
    .toArray()[0]?.revision;
  if (revision === undefined) {
    throw new Error("Message preview revision was not persisted");
  }
  return {
    revision,
    preview: recentPreviews[0] ?? null,
    recentPreviews,
  };
}
export async function projectSpaceMessagePreview(input: {
  db: PostgresDatabase;
  spaceId: string;
  revision: number;
  preview: SpaceMessagePreview;
  recentPreviews?: NonNullable<AccountSpaceIndexItem["recentMessagePreviews"]>;
}): Promise<void> {
  const result = await input.db.query({
    text: `
    UPDATE "openmeld"."space_index_spaces" SET message_preview_revision = $1, message_preview_json = $2, recent_message_previews_json = $5
    WHERE space_id = $3 AND status = 'active' AND (message_preview_revision IS NULL OR message_preview_revision <= $4)
  `,
    values: [
      input.revision,
      input.preview === null ? null : JSON.stringify(input.preview),
      input.spaceId,
      input.revision,
      input.recentPreviews === undefined
        ? null
        : JSON.stringify(input.recentPreviews),
    ],
  });
  if ((result.rowCount ?? 0) > 0) {
    return;
  }
  // A failed creation projection must not turn a no-op into a completed preview.
  const row = await input.db
    .query({
      text: 'SELECT space_id FROM "openmeld"."space_index_spaces" WHERE space_id = $1',
      values: [input.spaceId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    throw new Error("Space index must exist before its message preview");
  }
}
