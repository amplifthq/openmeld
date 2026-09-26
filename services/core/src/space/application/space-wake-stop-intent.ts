import type {
  SpaceWakeStopIntentQuery,
  SpaceWakeStopIntentResponse,
} from "@openmeld/schemas/types";
import { readDispatchOutboxRecordByDispatchId } from "../infrastructure/outbox/dispatch-outbox-repo";

/** Projection of Space's existing durable Stop intent, not execution settlement. */
export function readSpaceWakeStopIntent(
  sql: SqlStorage,
  query: SpaceWakeStopIntentQuery
): SpaceWakeStopIntentResponse {
  const record = readDispatchOutboxRecordByDispatchId(sql, query.dispatchId);
  if (
    !record ||
    record.spaceId !== query.spaceId ||
    record.targetProfileId !== query.targetProfileId
  ) {
    return { status: "not_found" };
  }
  return {
    status: record.outboxStatus === "cancelled" ? "requested" : "not_requested",
  };
}

/** Admission and Stop meet in the existing Space outbox. This synchronous
 * evidence records possible exposure to execution, never execution outcome. */
export function authorizeSpaceNativeWakeAdmission(
  sql: SqlStorage,
  query: SpaceWakeStopIntentQuery,
  nowMs: number
): SpaceWakeStopIntentResponse {
  const intent = readSpaceWakeStopIntent(sql, query);
  if (intent.status !== "not_requested") {
    return intent;
  }
  sql.exec(
    `UPDATE openMeldDaemon_outbox
     SET native_admission_started_at_ms = COALESCE(NULLIF(native_admission_started_at_ms, 0), ?)
     WHERE dispatch_id = ? AND space_id = ? AND target_profile_id = ?`,
    Math.max(1, nowMs),
    query.dispatchId,
    query.spaceId,
    query.targetProfileId
  );
  return intent;
}

export function isSpaceNativeWakeUnexposed(
  sql: SqlStorage,
  query: SpaceWakeStopIntentQuery
): boolean {
  const row = sql
    .exec<{ native_admission_started_at_ms: number | null }>(
      `SELECT native_admission_started_at_ms FROM openMeldDaemon_outbox
     WHERE dispatch_id = ? AND space_id = ? AND target_profile_id = ?`,
      query.dispatchId,
      query.spaceId,
      query.targetProfileId
    )
    .toArray()[0];
  return row?.native_admission_started_at_ms === 0;
}
