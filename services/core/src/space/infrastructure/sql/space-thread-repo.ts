import { SPACE_MESSAGE_CHANGED_PURPOSE } from "@openmeld/schemas";
import type {
  SpaceThread,
  SpaceThreadContext,
  SpaceThreadEvent,
  SpaceThreadSignalPlacement,
  SpaceThreadSignalPlacementKind,
} from "@openmeld/schemas/types";
import { isoToTimestampMs, timestampMsToIso } from "./space-schema-repo";

type SqlSpaceThreadRow = {
  thread_id: string;
  space_id: string;
  root_signal_id: string;
  created_by_profile_id: string;
  created_at_ms: number;
  updated_at_ms: number;
};

type SqlSpaceThreadSignalPlacementRow = {
  signal_id: string;
  thread_id: string;
  placement: string;
  created_at_ms: number;
};

type SqlSpaceThreadPreviewEntryRow = SqlSpaceThreadSignalPlacementRow & {
  payload_json: string | null;
};

export type SpaceThreadPreviewEntry = {
  payloadJson: string | null;
  placement: SpaceThreadSignalPlacement;
};

type SqlSpaceThreadEventRow = {
  event_id: string;
  thread_id: string;
  event_type: string;
  actor_profile_id: string;
  client_mutation_id: string;
  created_at_ms: number;
};

export function createSpaceThreadId(): string {
  return `thr_${crypto.randomUUID()}`;
}

/** Retained authors across the whole thread, including its root, not just a history page. */
export function readThreadParticipants(sql: SqlStorage, threadId: string) {
  return sql
    .exec<{ profileId: string; kind: string }>(
      `
    SELECT DISTINCT json_extract(signal.payload_json, '$.profile.profileId') AS profileId,
      json_extract(signal.payload_json, '$.profile.kind') AS kind
    FROM space_signals AS signal
    JOIN space_thread_signal_placements AS placement ON placement.signal_id = signal.id
    WHERE placement.thread_id = ?
      AND json_extract(signal.payload_json, '$.type') = 'signal.text'
      AND json_extract(signal.payload_json, '$.data.meta.recalledAt') IS NULL
      AND json_extract(signal.payload_json, '$.profile.kind') IN ('human', 'agent')
      AND COALESCE(json_extract(signal.payload_json, '$.data.meta.transient'), 0) != 1
  `,
      threadId
    )
    .toArray();
}

/** Use storage order, not author timestamps, and search beyond the visible page. */
export function readLatestExplicitThreadWake(
  sql: SqlStorage,
  threadId: string
): string | null {
  return (
    sql
      .exec<{ payload_json: string }>(
        `
    SELECT signal.payload_json FROM space_signals AS signal
    JOIN space_thread_signal_placements AS placement ON placement.signal_id = signal.id
    WHERE placement.thread_id = ?
      AND json_extract(signal.payload_json, '$.type') = 'signal.text'
      AND json_extract(signal.payload_json, '$.profile.kind') = 'human'
      AND json_extract(signal.payload_json, '$.data.meta.recalledAt') IS NULL
      AND COALESCE(json_extract(signal.payload_json, '$.data.meta.threadWakeContinuation'), 0) != 1
      AND json_array_length(json_extract(signal.payload_json, '$.data.messageEnvelope.activationTargets')) > 0
    ORDER BY signal.rowid DESC LIMIT 1
  `,
        threadId
      )
      .toArray()[0]?.payload_json ?? null
  );
}

export function insertSpaceThread(sql: SqlStorage, thread: SpaceThread): void {
  sql.exec(
    `
      INSERT INTO space_threads (
        thread_id,
        space_id,
        root_signal_id,
        created_by_profile_id,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    thread.threadId,
    thread.spaceId,
    thread.rootSignalId,
    thread.createdByProfileId,
    isoToTimestampMs(thread.createdAt),
    isoToTimestampMs(thread.updatedAt)
  );
}

export function updateSpaceThreadActivity(
  sql: SqlStorage,
  input: { threadId: string; updatedAt: string }
): void {
  sql.exec(
    `
      UPDATE space_threads
      SET updated_at_ms = ?
      WHERE thread_id = ?
    `,
    isoToTimestampMs(input.updatedAt),
    input.threadId
  );
}

export function readSpaceThread(
  sql: SqlStorage,
  threadId: string
): SpaceThread | null {
  const row = readOne(
    sql.exec<SqlSpaceThreadRow>(
      `
        SELECT *
        FROM space_threads
        WHERE thread_id = ?
        LIMIT 1
      `,
      threadId
    )
  );
  return row ? toSpaceThread(row) : null;
}

export function readSpaceThreadByRootSignalId(
  sql: SqlStorage,
  rootSignalId: string
): SpaceThread | null {
  const row = readOne(
    sql.exec<SqlSpaceThreadRow>(
      `
        SELECT *
        FROM space_threads
        WHERE root_signal_id = ?
        ORDER BY created_at_ms DESC, thread_id DESC
        LIMIT 1
      `,
      rootSignalId
    )
  );
  return row ? toSpaceThread(row) : null;
}

export function listSpaceThreads(sql: SqlStorage): SpaceThread[] {
  const rows = sql
    .exec<SqlSpaceThreadRow>(
      `
        SELECT t.*
        FROM space_threads t
        LEFT JOIN space_thread_signal_placements p
          ON p.thread_id = t.thread_id
        GROUP BY t.thread_id
        ORDER BY MAX(COALESCE(p.created_at_ms, t.updated_at_ms)) DESC,
          t.updated_at_ms DESC,
          t.thread_id DESC
      `
    )
    .toArray();
  return rows.map(toSpaceThread);
}

export function insertSpaceThreadSignalPlacement(
  sql: SqlStorage,
  placement: SpaceThreadSignalPlacement
): void {
  sql.exec(
    `
      INSERT INTO space_thread_signal_placements (
        signal_id,
        thread_id,
        placement,
        created_at_ms
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(signal_id) DO UPDATE SET
        thread_id = excluded.thread_id,
        placement = excluded.placement,
        created_at_ms = excluded.created_at_ms
    `,
    placement.signalId,
    placement.threadId,
    placement.placement,
    isoToTimestampMs(placement.createdAt)
  );
}

export function readSpaceThreadSignalPlacementBySignalId(
  sql: SqlStorage,
  signalId: string
): SpaceThreadSignalPlacement | null {
  const row = readOne(
    sql.exec<SqlSpaceThreadSignalPlacementRow>(
      `
        SELECT signal_id, thread_id, placement, created_at_ms
        FROM space_thread_signal_placements
        WHERE signal_id = ?
        LIMIT 1
      `,
      signalId
    )
  );
  return row ? toSpaceThreadSignalPlacement(row) : null;
}

/** Only the exact root and Space-owned Thread placement establish membership.
 * A quotation on the main timeline may start an independent request. */
export function listSpaceRequestRootSignalIds(
  sql: SqlStorage,
  input: { rootSignalId: string; limit: number; signalTypes: readonly string[] }
): string[] {
  const types = [...new Set(input.signalTypes)];
  if (types.length === 0) {
    throw new Error("Continuity signal types are required.");
  }
  const rows = sql
    .exec<{ id: string }>(
      `SELECT signal.id FROM space_signals AS signal
     WHERE signal.type IN (${types.map(() => "?").join(", ")})
       AND (signal.id = ?
         OR EXISTS (
           SELECT 1 FROM space_thread_signal_placements AS placement
           JOIN space_threads AS thread ON thread.thread_id = placement.thread_id
           WHERE placement.signal_id = signal.id AND thread.root_signal_id = ?
         ))
     ORDER BY signal.rowid DESC LIMIT ?`,
      ...types,
      input.rootSignalId,
      input.rootSignalId,
      input.limit
    )
    .toArray();
  return rows.toReversed().map((row) => row.id);
}

export function listSpaceThreadSignalPlacements(
  sql: SqlStorage,
  threadId: string
): SpaceThreadSignalPlacement[] {
  const rows = sql
    .exec<SqlSpaceThreadSignalPlacementRow>(
      `
        SELECT signal_id, thread_id, placement, created_at_ms
        FROM space_thread_signal_placements
        WHERE thread_id = ?
        ORDER BY created_at_ms ASC, signal_id ASC
      `,
      threadId
    )
    .toArray();
  return rows.map(toSpaceThreadSignalPlacement);
}

export function listSpaceThreadSignalPlacementsAfter(
  sql: SqlStorage,
  input: {
    afterSignalId: string;
    limit: number;
    threadId: string;
  }
): SpaceThreadSignalPlacement[] | null {
  const rows = sql
    .exec<SqlSpaceThreadSignalPlacementRow & { anchor_exists: number }>(
      `
        WITH anchor AS (
          SELECT signal.rowid AS storage_order
          FROM space_signals AS signal
          JOIN space_thread_signal_placements AS placement
            ON placement.signal_id = signal.id
          WHERE signal.id = ?
            AND placement.thread_id = ?
          LIMIT 1
        )
        SELECT
          placement.signal_id,
          placement.thread_id,
          placement.placement,
          placement.created_at_ms,
          EXISTS(SELECT 1 FROM anchor) AS anchor_exists
        FROM anchor
        LEFT JOIN space_signals AS signal
          ON signal.rowid > anchor.storage_order
        LEFT JOIN space_thread_signal_placements AS placement
          ON placement.signal_id = signal.id
          AND placement.thread_id = ?
        WHERE placement.signal_id IS NOT NULL
        ORDER BY signal.rowid ASC
        LIMIT ?
      `,
      input.afterSignalId,
      input.threadId,
      input.threadId,
      input.limit
    )
    .toArray();
  if (rows.length === 0) {
    const anchorExists = sql
      .exec<{ anchor_exists: number }>(
        `
          SELECT EXISTS(
            SELECT 1
            FROM space_thread_signal_placements
            WHERE signal_id = ? AND thread_id = ?
          ) AS anchor_exists
        `,
        input.afterSignalId,
        input.threadId
      )
      .toArray()[0]?.anchor_exists;
    return Number(anchorExists ?? 0) === 1 ? [] : null;
  }
  return rows.map(toSpaceThreadSignalPlacement);
}

export function listSpaceThreadSignalPlacementsBefore(
  sql: SqlStorage,
  input: {
    beforeSignalId: string;
    limit: number;
    signalTypes: readonly string[];
    threadId: string;
  }
): SpaceThreadSignalPlacement[] | null {
  const signalTypes = [...new Set(input.signalTypes)];
  if (signalTypes.length === 0) {
    throw new Error(
      "Thread history signal types are required before applying its limit."
    );
  }
  const signalTypePlaceholders = signalTypes.map(() => "?").join(", ");
  const rows = sql
    .exec<SqlSpaceThreadSignalPlacementRow & { anchor_exists: number }>(
      `
        WITH anchor AS (
          SELECT signal.rowid AS storage_order
          FROM space_signals AS signal
          JOIN space_thread_signal_placements AS placement
            ON placement.signal_id = signal.id
          WHERE signal.id = ?
            AND placement.thread_id = ?
          LIMIT 1
        )
        SELECT
          placement.signal_id,
          placement.thread_id,
          placement.placement,
          placement.created_at_ms,
          EXISTS(SELECT 1 FROM anchor) AS anchor_exists
        FROM anchor
        LEFT JOIN space_signals AS signal
          ON signal.rowid < anchor.storage_order
        LEFT JOIN space_thread_signal_placements AS placement
          ON placement.signal_id = signal.id
          AND placement.thread_id = ?
        WHERE placement.signal_id IS NOT NULL
          AND signal.type IN (${signalTypePlaceholders})
        ORDER BY signal.rowid DESC
        LIMIT ?
      `,
      input.beforeSignalId,
      input.threadId,
      input.threadId,
      ...signalTypes,
      input.limit
    )
    .toArray();
  if (rows.length === 0) {
    const anchorExists = sql
      .exec<{ anchor_exists: number }>(
        `
          SELECT EXISTS(
            SELECT 1
            FROM space_thread_signal_placements
            WHERE signal_id = ? AND thread_id = ?
          ) AS anchor_exists
        `,
        input.beforeSignalId,
        input.threadId
      )
      .toArray()[0]?.anchor_exists;
    return Number(anchorExists ?? 0) === 1 ? [] : null;
  }
  return rows.toReversed().map(toSpaceThreadSignalPlacement);
}

export function listSpaceThreadPreviewEntries(
  sql: SqlStorage
): SpaceThreadPreviewEntry[] {
  const rows = sql
    .exec<SqlSpaceThreadPreviewEntryRow>(
      `
        WITH ranked AS (
          SELECT p.signal_id, p.thread_id, p.placement, p.created_at_ms,
            ROW_NUMBER() OVER (
              PARTITION BY p.thread_id ORDER BY p.created_at_ms DESC, p.signal_id DESC
            ) AS preview_rank
          FROM space_thread_signal_placements p
          JOIN space_signals s ON s.id = p.signal_id
          WHERE p.placement = 'thread'
            AND json_valid(s.payload_json)
            AND NOT (
              COALESCE(json_extract(s.payload_json, '$.type'), '') = 'signal.text'
              AND COALESCE(json_extract(s.payload_json, '$.profile.kind'), '') = 'system'
              AND COALESCE(json_extract(s.payload_json, '$.data.meta.purpose'), '') = ?
            )
        )
        SELECT
          p.signal_id,
          p.thread_id,
          p.placement,
          p.created_at_ms,
          CASE WHEN p.preview_rank <= 2 THEN s.payload_json ELSE NULL END AS payload_json
        FROM ranked p
        LEFT JOIN space_signals s
          ON s.id = p.signal_id AND p.preview_rank <= 2
        ORDER BY p.thread_id ASC, p.created_at_ms ASC, p.signal_id ASC
      `,
      SPACE_MESSAGE_CHANGED_PURPOSE
    )
    .toArray();
  return rows.map((row) => ({
    payloadJson: row.payload_json,
    placement: toSpaceThreadSignalPlacement(row),
  }));
}

export function insertSpaceThreadEvent(
  sql: SqlStorage,
  event: SpaceThreadEvent
): void {
  sql.exec(
    `
      INSERT INTO space_thread_events (
        event_id,
        thread_id,
        event_type,
        actor_profile_id,
        client_mutation_id,
        created_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    event.eventId,
    event.threadId,
    event.eventType,
    event.actorProfileId,
    event.clientMutationId,
    isoToTimestampMs(event.createdAt)
  );
}

export function listSpaceThreadEvents(
  sql: SqlStorage,
  threadId: string
): SpaceThreadEvent[] {
  const rows = sql
    .exec<SqlSpaceThreadEventRow>(
      `
        SELECT
          event_id,
          thread_id,
          event_type,
          actor_profile_id,
          client_mutation_id,
          created_at_ms
        FROM space_thread_events
        WHERE thread_id = ?
        ORDER BY created_at_ms ASC, event_id ASC
      `,
      threadId
    )
    .toArray();
  return rows.map(toSpaceThreadEvent);
}

export function toSpaceThreadContext(thread: SpaceThread): SpaceThreadContext {
  return {
    threadId: thread.threadId,
    rootSignalId: thread.rootSignalId,
  };
}

export function createSpaceThreadSignalPlacement(input: {
  threadId: string;
  signalId: string;
  placement: SpaceThreadSignalPlacementKind;
  createdAt: string;
}): SpaceThreadSignalPlacement {
  return {
    threadId: input.threadId,
    signalId: input.signalId,
    placement: input.placement,
    createdAt: input.createdAt,
  };
}

function toSpaceThread(row: SqlSpaceThreadRow): SpaceThread {
  return {
    threadId: row.thread_id,
    spaceId: row.space_id,
    rootSignalId: row.root_signal_id,
    createdByProfileId: row.created_by_profile_id,
    createdAt: timestampMsToIso(row.created_at_ms),
    updatedAt: timestampMsToIso(row.updated_at_ms),
  };
}

function toSpaceThreadSignalPlacement(
  row: SqlSpaceThreadSignalPlacementRow
): SpaceThreadSignalPlacement {
  return {
    threadId: row.thread_id,
    signalId: row.signal_id,
    placement: normalizePlacement(row.placement),
    createdAt: timestampMsToIso(row.created_at_ms),
  };
}

function toSpaceThreadEvent(row: SqlSpaceThreadEventRow): SpaceThreadEvent {
  return {
    eventId: row.event_id,
    threadId: row.thread_id,
    eventType: "created",
    actorProfileId: row.actor_profile_id,
    clientMutationId: row.client_mutation_id,
    createdAt: timestampMsToIso(row.created_at_ms),
  };
}

function normalizePlacement(value: string): SpaceThreadSignalPlacementKind {
  return value === "root" ? "root" : "thread";
}

function readOne<T>(cursor: { toArray(): T[] }): T | undefined {
  return cursor.toArray()[0];
}
