import type { SpaceMemberRecord } from "./space-member-repo";
import type { SpaceMetaRecord } from "./space-meta-repo";

export const SPACE_INDEX_PROJECTION_OUTBOX_STATUS_PENDING = "pending" as const;
export const SPACE_INDEX_PROJECTION_OUTBOX_STATUS_FAILED = "failed" as const;
export const SPACE_INDEX_PROJECTION_OUTBOX_STATUS_COMPLETED =
  "completed" as const;

export type SpaceIndexProjectionOutboxStatus =
  | typeof SPACE_INDEX_PROJECTION_OUTBOX_STATUS_PENDING
  | typeof SPACE_INDEX_PROJECTION_OUTBOX_STATUS_FAILED
  | typeof SPACE_INDEX_PROJECTION_OUTBOX_STATUS_COMPLETED;

export type SpaceIndexActiveProjectionEventType =
  | "space.index_backfilled"
  | "space.created"
  | "space.meta_updated"
  | "space.members_updated";

export type SpaceIndexProjectionOutboxSnapshot =
  | {
      kind: "active";
      eventType: SpaceIndexActiveProjectionEventType;
      memberRecords: readonly SpaceMemberRecord[];
      metaRecord: SpaceMetaRecord;
    }
  | {
      kind: "deleted";
      deletedAt: string;
      deletedByOwnerUserId?: string | null;
      deletedByProfileId?: string | null;
      deletedByProfileName?: string | null;
      eventType: "space.deleted";
      memberRecords: readonly SpaceMemberRecord[];
      metaRecord: SpaceMetaRecord;
    };

export type SpaceIndexProjectionOutboxRecord = {
  attemptCount: number;
  completedAtMs: number | null;
  createdAtMs: number;
  eventType: SpaceIndexProjectionOutboxSnapshot["eventType"];
  lastError: string | null;
  nextRetryAtMs: number | null;
  projectionId: string;
  snapshot: SpaceIndexProjectionOutboxSnapshot;
  sourceUpdatedAt: string;
  spaceId: string;
  status: SpaceIndexProjectionOutboxStatus;
  updatedAtMs: number;
};

type SpaceIndexProjectionOutboxRow = {
  attempt_count: number;
  completed_at_ms: number | null;
  created_at_ms: number;
  event_type: string;
  last_error: string | null;
  next_retry_at_ms: number | null;
  projection_id: string;
  snapshot_json: string;
  source_updated_at_ms: number;
  space_id: string;
  status: string;
  updated_at_ms: number;
};

export function createActiveSpaceIndexProjectionOutboxRecord(input: {
  eventType: SpaceIndexActiveProjectionEventType;
  memberRecords: readonly SpaceMemberRecord[];
  metaRecord: SpaceMetaRecord;
  nowMs?: number;
  projectionId?: string;
}): SpaceIndexProjectionOutboxRecord {
  const nowMs = input.nowMs ?? Date.now();
  const sourceUpdatedAt = resolveActiveSnapshotSourceUpdatedAt({
    memberRecords: input.memberRecords,
    metaRecord: input.metaRecord,
  });
  return createSpaceIndexProjectionOutboxRecord({
    eventType: input.eventType,
    nowMs,
    projectionId: input.projectionId,
    snapshot: {
      kind: "active",
      eventType: input.eventType,
      memberRecords: input.memberRecords,
      metaRecord: input.metaRecord,
    },
    sourceUpdatedAt,
    spaceId: input.metaRecord.spaceId,
  });
}

export function createDeletedSpaceIndexProjectionOutboxRecord(input: {
  deletedAt: string;
  deletedByOwnerUserId?: string | null;
  deletedByProfileId?: string | null;
  deletedByProfileName?: string | null;
  memberRecords: readonly SpaceMemberRecord[];
  metaRecord: SpaceMetaRecord;
  nowMs?: number;
  projectionId?: string;
}): SpaceIndexProjectionOutboxRecord {
  const nowMs = input.nowMs ?? Date.now();
  return createSpaceIndexProjectionOutboxRecord({
    eventType: "space.deleted",
    nowMs,
    projectionId: input.projectionId,
    snapshot: {
      kind: "deleted",
      deletedAt: input.deletedAt,
      deletedByOwnerUserId: input.deletedByOwnerUserId ?? null,
      deletedByProfileId: input.deletedByProfileId ?? null,
      deletedByProfileName: input.deletedByProfileName ?? null,
      eventType: "space.deleted",
      memberRecords: input.memberRecords,
      metaRecord: input.metaRecord,
    },
    sourceUpdatedAt: input.deletedAt,
    spaceId: input.metaRecord.spaceId,
  });
}

export const insertSpaceIndexProjectionOutboxRecord = (
  sql: SqlStorage,
  record: SpaceIndexProjectionOutboxRecord
): boolean => {
  const result = sql.exec(
    `
      INSERT OR IGNORE INTO space_index_projection_outbox (
        projection_id,
        space_id,
        event_type,
        source_updated_at_ms,
        snapshot_json,
        status,
        attempt_count,
        last_error,
        next_retry_at_ms,
        completed_at_ms,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    record.projectionId,
    record.spaceId,
    record.eventType,
    Date.parse(record.sourceUpdatedAt),
    JSON.stringify(record.snapshot),
    record.status,
    record.attemptCount,
    record.lastError,
    record.nextRetryAtMs,
    record.completedAtMs,
    record.createdAtMs,
    record.updatedAtMs
  );
  return Number(result.rowsWritten ?? 0) > 0;
};

export const markSpaceIndexProjectionOutboxCompleted = (
  sql: SqlStorage,
  input: {
    completedAtMs: number;
    projectionId: string;
  }
): void => {
  sql.exec(
    `
      UPDATE space_index_projection_outbox
      SET status = ?,
        last_error = NULL,
        next_retry_at_ms = NULL,
        completed_at_ms = ?,
        updated_at_ms = ?
      WHERE projection_id = ?
    `,
    SPACE_INDEX_PROJECTION_OUTBOX_STATUS_COMPLETED,
    input.completedAtMs,
    input.completedAtMs,
    input.projectionId
  );
};

export const markSpaceIndexProjectionOutboxFailed = (
  sql: SqlStorage,
  input: {
    failedAtMs: number;
    lastError: string;
    nextRetryAtMs: number;
    projectionId: string;
  }
): void => {
  sql.exec(
    `
      UPDATE space_index_projection_outbox
      SET status = ?,
        attempt_count = attempt_count + 1,
        last_error = ?,
        next_retry_at_ms = ?,
        updated_at_ms = ?
      WHERE projection_id = ?
    `,
    SPACE_INDEX_PROJECTION_OUTBOX_STATUS_FAILED,
    input.lastError,
    input.nextRetryAtMs,
    input.failedAtMs,
    input.projectionId
  );
};

export const listDueSpaceIndexProjectionOutboxRecords = (
  sql: SqlStorage,
  input: {
    limit: number;
    nowMs: number;
  }
): SpaceIndexProjectionOutboxRecord[] => {
  const rows = sql
    .exec<SpaceIndexProjectionOutboxRow>(
      `
        SELECT
          projection_id,
          space_id,
          event_type,
          source_updated_at_ms,
          snapshot_json,
          status,
          attempt_count,
          last_error,
          next_retry_at_ms,
          completed_at_ms,
          created_at_ms,
          updated_at_ms
        FROM space_index_projection_outbox
        WHERE status IN (?, ?)
          AND (next_retry_at_ms IS NULL OR next_retry_at_ms <= ?)
        ORDER BY created_at_ms ASC, projection_id ASC
        LIMIT ?
      `,
      SPACE_INDEX_PROJECTION_OUTBOX_STATUS_PENDING,
      SPACE_INDEX_PROJECTION_OUTBOX_STATUS_FAILED,
      input.nowMs,
      Math.max(1, input.limit)
    )
    .toArray();

  return rows.map(toSpaceIndexProjectionOutboxRecord);
};

export const readNextSpaceIndexProjectionOutboxAlarmAtMs = (
  sql: SqlStorage,
  input: { nowMs: number }
): number | null => {
  const dueRows = sql
    .exec<{ projection_id: string }>(
      `
        SELECT projection_id
        FROM space_index_projection_outbox
        WHERE status IN (?, ?)
          AND (next_retry_at_ms IS NULL OR next_retry_at_ms <= ?)
        LIMIT 1
      `,
      SPACE_INDEX_PROJECTION_OUTBOX_STATUS_PENDING,
      SPACE_INDEX_PROJECTION_OUTBOX_STATUS_FAILED,
      input.nowMs
    )
    .toArray();
  if (dueRows.length > 0) {
    return input.nowMs;
  }

  const rows = sql
    .exec<{ next_retry_at_ms: number | null }>(
      `
        SELECT next_retry_at_ms
        FROM space_index_projection_outbox
        WHERE status IN (?, ?)
          AND next_retry_at_ms IS NOT NULL
        ORDER BY next_retry_at_ms ASC
        LIMIT 1
      `,
      SPACE_INDEX_PROJECTION_OUTBOX_STATUS_PENDING,
      SPACE_INDEX_PROJECTION_OUTBOX_STATUS_FAILED
    )
    .toArray();
  const nextRetryAtMs = rows[0]?.next_retry_at_ms;
  return typeof nextRetryAtMs === "number" ? nextRetryAtMs : null;
};

export const readSpaceIndexProjectionOutboxRecord = (
  sql: SqlStorage,
  projectionId: string
): SpaceIndexProjectionOutboxRecord | null => {
  const rows = sql
    .exec<SpaceIndexProjectionOutboxRow>(
      `
        SELECT
          projection_id,
          space_id,
          event_type,
          source_updated_at_ms,
          snapshot_json,
          status,
          attempt_count,
          last_error,
          next_retry_at_ms,
          completed_at_ms,
          created_at_ms,
          updated_at_ms
        FROM space_index_projection_outbox
        WHERE projection_id = ?
        LIMIT 1
      `,
      projectionId
    )
    .toArray();
  const row = rows[0];
  return row ? toSpaceIndexProjectionOutboxRecord(row) : null;
};

function createSpaceIndexProjectionOutboxRecord(input: {
  eventType: SpaceIndexProjectionOutboxSnapshot["eventType"];
  nowMs: number;
  projectionId?: string;
  snapshot: SpaceIndexProjectionOutboxSnapshot;
  sourceUpdatedAt: string;
  spaceId: string;
}): SpaceIndexProjectionOutboxRecord {
  return {
    attemptCount: 0,
    completedAtMs: null,
    createdAtMs: input.nowMs,
    eventType: input.eventType,
    lastError: null,
    nextRetryAtMs: null,
    projectionId: input.projectionId ?? `spidx_${crypto.randomUUID()}`,
    snapshot: input.snapshot,
    sourceUpdatedAt: input.sourceUpdatedAt,
    spaceId: input.spaceId,
    status: SPACE_INDEX_PROJECTION_OUTBOX_STATUS_PENDING,
    updatedAtMs: input.nowMs,
  };
}

function toSpaceIndexProjectionOutboxRecord(
  row: SpaceIndexProjectionOutboxRow
): SpaceIndexProjectionOutboxRecord {
  const snapshot = parseProjectionSnapshot(row.snapshot_json);
  return {
    attemptCount: Number(row.attempt_count ?? 0),
    completedAtMs:
      typeof row.completed_at_ms === "number" ? row.completed_at_ms : null,
    createdAtMs: Number(row.created_at_ms),
    eventType: snapshot.eventType,
    lastError: row.last_error ?? null,
    nextRetryAtMs:
      typeof row.next_retry_at_ms === "number" ? row.next_retry_at_ms : null,
    projectionId: String(row.projection_id),
    snapshot,
    sourceUpdatedAt: new Date(Number(row.source_updated_at_ms)).toISOString(),
    spaceId: String(row.space_id),
    status: parseProjectionOutboxStatus(row.status),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function parseProjectionSnapshot(
  value: string
): SpaceIndexProjectionOutboxSnapshot {
  const parsed = JSON.parse(value) as SpaceIndexProjectionOutboxSnapshot;
  if (parsed.kind === "active" || parsed.kind === "deleted") {
    return parsed;
  }
  throw new Error("space index projection outbox snapshot is invalid");
}

function parseProjectionOutboxStatus(
  value: string
): SpaceIndexProjectionOutboxStatus {
  if (
    value === SPACE_INDEX_PROJECTION_OUTBOX_STATUS_PENDING ||
    value === SPACE_INDEX_PROJECTION_OUTBOX_STATUS_FAILED ||
    value === SPACE_INDEX_PROJECTION_OUTBOX_STATUS_COMPLETED
  ) {
    return value;
  }
  throw new Error(`unknown space index projection outbox status: ${value}`);
}

function resolveActiveSnapshotSourceUpdatedAt(input: {
  memberRecords: readonly SpaceMemberRecord[];
  metaRecord: SpaceMetaRecord;
}): string {
  const sourceUpdatedAtMs = input.memberRecords.reduce(
    (current, memberRecord) =>
      Math.max(current, Date.parse(memberRecord.updatedAt)),
    Date.parse(input.metaRecord.updatedAt)
  );
  return new Date(sourceUpdatedAtMs).toISOString();
}
