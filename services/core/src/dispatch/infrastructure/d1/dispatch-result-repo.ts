import { dispatchResultSchema } from "@openmeld/schemas";
import type { DispatchResult } from "@openmeld/schemas/types";

type DispatchResultRow = {
  result_ref: string;
  dispatch_id: string;
  space_id: string;
  actor_profile_id: string;
  actor_name: string | null;
  reply_to_signal_id: string | null;
  result_kind: string;
  final_text: string | null;
  message_envelope_json: string | null;
  status_type: string | null;
  preview_text: string | null;
  public_outcome: string;
  published_signal_id: string | null;
  created_at_ms: number;
};

export const upsertDispatchResult = async (
  db: D1Database,
  result: DispatchResult
): Promise<void> => {
  const parsed = dispatchResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error("dispatch result is invalid");
  }

  const value = parsed.data;
  await db
    .prepare(
      `
        INSERT INTO openMeldDaemon_dispatch_results (
          result_ref,
          dispatch_id,
          space_id,
          actor_profile_id,
          actor_name,
          reply_to_signal_id,
          result_kind,
          final_text,
          message_envelope_json,
          status_type,
          preview_text,
          public_outcome,
          published_signal_id,
          created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(result_ref) DO UPDATE SET
          dispatch_id = excluded.dispatch_id,
          space_id = excluded.space_id,
          actor_profile_id = excluded.actor_profile_id,
          actor_name = excluded.actor_name,
          reply_to_signal_id = excluded.reply_to_signal_id,
          result_kind = excluded.result_kind,
          final_text = excluded.final_text,
          message_envelope_json = excluded.message_envelope_json,
          status_type = excluded.status_type,
          preview_text = excluded.preview_text,
          public_outcome = excluded.public_outcome,
          published_signal_id = excluded.published_signal_id,
          created_at_ms = excluded.created_at_ms
      `
    )
    .bind(
      value.resultRef,
      value.dispatchId,
      value.spaceId,
      value.actorProfileId,
      value.actorName ?? null,
      value.replyToSignalId ?? null,
      value.resultKind,
      value.finalText ?? null,
      value.messageEnvelope ? JSON.stringify(value.messageEnvelope) : null,
      value.statusType ?? null,
      value.previewText ?? null,
      value.publicOutcome,
      value.publishedSignalId ?? null,
      Date.parse(value.createdAt)
    )
    .run();
};

export const readDispatchResultByResultRef = async (
  db: D1Database,
  resultRef: string
): Promise<DispatchResult | null> => {
  const row = await db
    .prepare(
      `
        SELECT
          result_ref,
          dispatch_id,
          space_id,
          actor_profile_id,
          actor_name,
          reply_to_signal_id,
          result_kind,
          final_text,
          message_envelope_json,
          status_type,
          preview_text,
          public_outcome,
          published_signal_id,
          created_at_ms
        FROM openMeldDaemon_dispatch_results
        WHERE result_ref = ?
        LIMIT 1
      `
    )
    .bind(resultRef)
    .first<DispatchResultRow>();

  return row ? mapDispatchResultRow(row) : null;
};

export const readDispatchResultByDispatchId = async (
  db: D1Database,
  dispatchId: string
): Promise<DispatchResult | null> => {
  const row = await db
    .prepare(
      `
        SELECT
          result_ref,
          dispatch_id,
          space_id,
          actor_profile_id,
          actor_name,
          reply_to_signal_id,
          result_kind,
          final_text,
          message_envelope_json,
          status_type,
          preview_text,
          public_outcome,
          published_signal_id,
          created_at_ms
        FROM openMeldDaemon_dispatch_results
        WHERE dispatch_id = ?
        LIMIT 1
      `
    )
    .bind(dispatchId)
    .first<DispatchResultRow>();

  return row ? mapDispatchResultRow(row) : null;
};

function mapDispatchResultRow(row: DispatchResultRow): DispatchResult {
  const parsed = dispatchResultSchema.safeParse({
    resultRef: row.result_ref,
    dispatchId: row.dispatch_id,
    spaceId: row.space_id,
    actorProfileId: row.actor_profile_id,
    ...(row.actor_name ? { actorName: row.actor_name } : {}),
    ...(row.reply_to_signal_id
      ? { replyToSignalId: row.reply_to_signal_id }
      : {}),
    resultKind: row.result_kind,
    ...(row.final_text ? { finalText: row.final_text } : {}),
    ...(row.message_envelope_json
      ? { messageEnvelope: JSON.parse(row.message_envelope_json) }
      : {}),
    ...(row.status_type ? { statusType: row.status_type } : {}),
    ...(row.preview_text ? { previewText: row.preview_text } : {}),
    publicOutcome: row.public_outcome,
    ...(row.published_signal_id
      ? { publishedSignalId: row.published_signal_id }
      : {}),
    createdAt: new Date(row.created_at_ms).toISOString(),
  });
  if (!parsed.success) {
    throw new Error("dispatch result row is invalid");
  }
  return parsed.data;
}
