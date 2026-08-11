import { inboxSourceCandidateSchema } from "@openmeld/schemas";
import type { InboxSourceCandidate } from "@openmeld/schemas/types";

export type SpaceInboxProjectionOutboxStatus =
  | "completed"
  | "failed"
  | "pending";

export type SpaceInboxProjectionOutboxRecord = {
  attemptCount: number;
  candidates: readonly InboxSourceCandidate[];
  completedAtMs: number | null;
  createdAtMs: number;
  lastErrorCode: string | null;
  nextRetryAtMs: number | null;
  projectionId: string;
  signalId: string;
  spaceId: string;
  status: SpaceInboxProjectionOutboxStatus;
  updatedAtMs: number;
};

type SpaceInboxProjectionOutboxRow = {
  attempt_count: number;
  candidates_json: string;
  completed_at_ms: number | null;
  created_at_ms: number;
  last_error_code: string | null;
  next_retry_at_ms: number | null;
  projection_id: string;
  signal_id: string;
  space_id: string;
  status: string;
  updated_at_ms: number;
};

const RECORD_COLUMNS = `
  projection_id,
  space_id,
  signal_id,
  candidates_json,
  status,
  attempt_count,
  last_error_code,
  next_retry_at_ms,
  completed_at_ms,
  created_at_ms,
  updated_at_ms
`;

export function insertSpaceInboxProjectionOutboxRecord(
  sql: SqlStorage,
  record: SpaceInboxProjectionOutboxRecord
): boolean {
  const candidates = inboxSourceCandidateSchema
    .array()
    .parse(record.candidates);
  const result = sql.exec(
    `
      INSERT OR IGNORE INTO space_inbox_projection_outbox (
        ${RECORD_COLUMNS}
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    record.projectionId,
    record.spaceId,
    record.signalId,
    JSON.stringify(candidates),
    record.status,
    record.attemptCount,
    record.lastErrorCode,
    record.nextRetryAtMs,
    record.completedAtMs,
    record.createdAtMs,
    record.updatedAtMs
  );
  return Number(result.rowsWritten ?? 0) > 0;
}

export function listDueSpaceInboxProjectionOutboxRecords(
  sql: SqlStorage,
  input: { limit: number; nowMs: number }
): SpaceInboxProjectionOutboxRecord[] {
  return sql
    .exec<SpaceInboxProjectionOutboxRow>(
      `
        SELECT ${RECORD_COLUMNS}
        FROM space_inbox_projection_outbox
        WHERE status IN ('pending', 'failed')
          AND (next_retry_at_ms IS NULL OR next_retry_at_ms <= ?)
        ORDER BY created_at_ms ASC, projection_id ASC
        LIMIT ?
      `,
      input.nowMs,
      Math.max(1, input.limit)
    )
    .toArray()
    .map(toRecord);
}

export function readNextSpaceInboxProjectionOutboxAlarmAtMs(
  sql: SqlStorage,
  input: { nowMs: number }
): number | null {
  const due = sql
    .exec<{ projection_id: string }>(
      `
        SELECT projection_id
        FROM space_inbox_projection_outbox
        WHERE status IN ('pending', 'failed')
          AND (next_retry_at_ms IS NULL OR next_retry_at_ms <= ?)
        LIMIT 1
      `,
      input.nowMs
    )
    .toArray();
  if (due.length > 0) {
    return input.nowMs;
  }
  const [next] = sql
    .exec<{ next_retry_at_ms: number }>(
      `
        SELECT next_retry_at_ms
        FROM space_inbox_projection_outbox
        WHERE status IN ('pending', 'failed')
          AND next_retry_at_ms IS NOT NULL
        ORDER BY next_retry_at_ms ASC
        LIMIT 1
      `
    )
    .toArray();
  return typeof next?.next_retry_at_ms === "number"
    ? next.next_retry_at_ms
    : null;
}

export function markSpaceInboxProjectionOutboxCompleted(
  sql: SqlStorage,
  input: { completedAtMs: number; projectionId: string }
): void {
  sql.exec(
    `
      UPDATE space_inbox_projection_outbox
      SET status = 'completed',
        last_error_code = NULL,
        next_retry_at_ms = NULL,
        completed_at_ms = ?,
        updated_at_ms = ?
      WHERE projection_id = ?
    `,
    input.completedAtMs,
    input.completedAtMs,
    input.projectionId
  );
}

export function markSpaceInboxProjectionOutboxFailed(
  sql: SqlStorage,
  input: {
    candidates: readonly InboxSourceCandidate[];
    errorCode: string;
    failedAtMs: number;
    nextRetryAtMs: number;
    projectionId: string;
  }
): void {
  const candidates = inboxSourceCandidateSchema.array().parse(input.candidates);
  sql.exec(
    `
      UPDATE space_inbox_projection_outbox
      SET status = 'failed',
        candidates_json = ?,
        attempt_count = attempt_count + 1,
        last_error_code = ?,
        next_retry_at_ms = ?,
        updated_at_ms = ?
      WHERE projection_id = ?
    `,
    JSON.stringify(candidates),
    input.errorCode,
    input.nextRetryAtMs,
    input.failedAtMs,
    input.projectionId
  );
}

function toRecord(
  row: SpaceInboxProjectionOutboxRow
): SpaceInboxProjectionOutboxRecord {
  const status = parseStatus(row.status);
  const candidates = inboxSourceCandidateSchema
    .array()
    .parse(JSON.parse(row.candidates_json));
  return {
    attemptCount: Number(row.attempt_count),
    candidates,
    completedAtMs: row.completed_at_ms,
    createdAtMs: Number(row.created_at_ms),
    lastErrorCode: row.last_error_code,
    nextRetryAtMs: row.next_retry_at_ms,
    projectionId: String(row.projection_id),
    signalId: String(row.signal_id),
    spaceId: String(row.space_id),
    status,
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function parseStatus(value: string): SpaceInboxProjectionOutboxStatus {
  if (value === "pending" || value === "failed" || value === "completed") {
    return value;
  }
  throw new Error(`unknown Space Inbox projection status: ${value}`);
}
