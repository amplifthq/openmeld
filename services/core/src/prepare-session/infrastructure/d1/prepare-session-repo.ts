import {
  prepareSessionEventSchema,
  prepareSessionSnapshotSchema,
} from "@openmeld/schemas";
import type {
  PrepareSessionEvent,
  PrepareSessionSnapshot,
} from "@openmeld/schemas/types";

export type PrepareSessionRecord = {
  snapshot: PrepareSessionSnapshot;
};

export type CompareAndSetPrepareSessionResult =
  | "updated"
  | "missing"
  | "conflict";

type PrepareSessionRow = {
  prepare_session_id: string;
  snapshot_json: string;
};

type PrepareSessionEventRow = {
  event_id: string;
  event_json: string;
};

export async function createPrepareSessionRecord(input: {
  creationIdempotencyKey?: string | null;
  db: D1Database;
  snapshot: PrepareSessionSnapshot;
  tokenDigest: string;
  tokenIssuedAtMs: number;
  tokenExpiresAtMs: number;
  event: PrepareSessionEvent;
}): Promise<boolean> {
  const snapshot = assertValidPrepareSessionSnapshot(input.snapshot);
  const event = assertValidPrepareSessionEvent(input.event);
  const createdAtMs = Date.parse(snapshot.createdAt);
  const updatedAtMs = Date.parse(snapshot.updatedAt);
  const completedAtMs =
    snapshot.completedAt === null ? null : Date.parse(snapshot.completedAt);
  const expiresAtMs = Date.parse(snapshot.expiresAt);
  const creationIdempotencyKey = input.creationIdempotencyKey ?? null;
  const requireCreatedSession = creationIdempotencyKey !== null;
  const results = await input.db.batch([
    input.db
      .prepare(
        `
          INSERT INTO openMeldDaemon_prepare_sessions (
            prepare_session_id,
            owner_user_id,
            human_profile_id,
            device_id,
            runtime_lane,
            target_space_id,
            creation_idempotency_key,
            lifecycle_status,
            phase,
            session_revision,
            snapshot_json,
            diagnostic_correlation_id,
            created_at_ms,
            updated_at_ms,
            completed_at_ms,
            expires_at_ms
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ${
            requireCreatedSession
              ? "ON CONFLICT(owner_user_id, creation_idempotency_key) DO NOTHING"
              : ""
          }
        `
      )
      .bind(
        snapshot.prepareSessionId,
        snapshot.ownerUserId,
        snapshot.humanProfileId,
        snapshot.deviceId,
        snapshot.runtimeLane,
        snapshot.targetSpaceId,
        creationIdempotencyKey,
        snapshot.lifecycleStatus,
        snapshot.phase,
        snapshot.sessionRevision,
        JSON.stringify(snapshot),
        snapshot.diagnosticCorrelationId,
        createdAtMs,
        updatedAtMs,
        completedAtMs,
        expiresAtMs
      ),
    buildCreateTokenStatement(input.db, {
      expiresAtMs: input.tokenExpiresAtMs,
      issuedAtMs: input.tokenIssuedAtMs,
      ownerUserId: snapshot.ownerUserId,
      prepareSessionId: snapshot.prepareSessionId,
      requireCreatedSession,
      tokenDigest: input.tokenDigest,
    }),
    buildAppendEventStatement(input.db, {
      event,
      ownerUserId: snapshot.ownerUserId,
      requirePrepareSessionExists: requireCreatedSession,
    }),
  ]);

  return didWriteRows(results[0]);
}

function buildCreateTokenStatement(
  db: D1Database,
  input: {
    expiresAtMs: number;
    issuedAtMs: number;
    ownerUserId: string;
    prepareSessionId: string;
    requireCreatedSession: boolean;
    tokenDigest: string;
  }
): D1PreparedStatement {
  if (!input.requireCreatedSession) {
    return db
      .prepare(
        `
          INSERT INTO openMeldDaemon_prepare_session_tokens (
            token_digest,
            prepare_session_id,
            owner_user_id,
            issued_at_ms,
            expires_at_ms,
            revoked_at_ms
          )
          VALUES (?, ?, ?, ?, ?, NULL)
        `
      )
      .bind(
        input.tokenDigest,
        input.prepareSessionId,
        input.ownerUserId,
        input.issuedAtMs,
        input.expiresAtMs
      );
  }

  return db
    .prepare(
      `
        INSERT INTO openMeldDaemon_prepare_session_tokens (
          token_digest,
          prepare_session_id,
          owner_user_id,
          issued_at_ms,
          expires_at_ms,
          revoked_at_ms
        )
        SELECT ?, ?, ?, ?, ?, NULL
        WHERE EXISTS (
          SELECT 1
          FROM openMeldDaemon_prepare_sessions
          WHERE prepare_session_id = ?
        )
      `
    )
    .bind(
      input.tokenDigest,
      input.prepareSessionId,
      input.ownerUserId,
      input.issuedAtMs,
      input.expiresAtMs,
      input.prepareSessionId
    );
}

export async function readPrepareSessionRecord(input: {
  db: D1Database;
  prepareSessionId: string;
}): Promise<PrepareSessionRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT prepare_session_id, snapshot_json
        FROM openMeldDaemon_prepare_sessions
        WHERE prepare_session_id = ?
        LIMIT 1
      `
    )
    .bind(input.prepareSessionId)
    .first<PrepareSessionRow>();

  return row ? mapPrepareSessionRow(row) : null;
}

export async function readPrepareSessionRecordByTokenDigest(input: {
  db: D1Database;
  tokenDigest: string;
  nowMs: number;
}): Promise<PrepareSessionRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT s.prepare_session_id, s.snapshot_json
        FROM openMeldDaemon_prepare_session_tokens t
        INNER JOIN openMeldDaemon_prepare_sessions s
          ON s.prepare_session_id = t.prepare_session_id
        WHERE t.token_digest = ?
          AND t.revoked_at_ms IS NULL
          AND t.expires_at_ms > ?
        LIMIT 1
      `
    )
    .bind(input.tokenDigest, input.nowMs)
    .first<PrepareSessionRow>();

  return row ? mapPrepareSessionRow(row) : null;
}

export async function updatePrepareSessionSnapshotIfRevision(input: {
  db: D1Database;
  expectedRevision: number;
  snapshot: PrepareSessionSnapshot;
}): Promise<CompareAndSetPrepareSessionResult> {
  const snapshot = assertValidPrepareSessionSnapshot(input.snapshot);
  const completedAtMs =
    snapshot.completedAt === null ? null : Date.parse(snapshot.completedAt);
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_prepare_sessions
        SET human_profile_id = ?,
            device_id = ?,
            runtime_lane = ?,
            target_space_id = ?,
            lifecycle_status = ?,
            phase = ?,
            session_revision = ?,
            snapshot_json = ?,
            diagnostic_correlation_id = ?,
            updated_at_ms = ?,
            completed_at_ms = ?,
            expires_at_ms = ?
        WHERE prepare_session_id = ?
          AND session_revision = ?
      `
    )
    .bind(
      snapshot.humanProfileId,
      snapshot.deviceId,
      snapshot.runtimeLane,
      snapshot.targetSpaceId,
      snapshot.lifecycleStatus,
      snapshot.phase,
      snapshot.sessionRevision,
      JSON.stringify(snapshot),
      snapshot.diagnosticCorrelationId,
      Date.parse(snapshot.updatedAt),
      completedAtMs,
      Date.parse(snapshot.expiresAt),
      snapshot.prepareSessionId,
      input.expectedRevision
    )
    .run();
  if (didWriteRows(result)) {
    return "updated";
  }

  const current = await readPrepareSessionRecord({
    db: input.db,
    prepareSessionId: snapshot.prepareSessionId,
  });
  return current ? "conflict" : "missing";
}

export async function mintPrepareSessionTokenRecord(input: {
  db: D1Database;
  prepareSessionId: string;
  ownerUserId: string;
  tokenDigest: string;
  issuedAtMs: number;
  expiresAtMs: number;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_prepare_session_tokens (
          token_digest,
          prepare_session_id,
          owner_user_id,
          issued_at_ms,
          expires_at_ms,
          revoked_at_ms
        )
        SELECT ?, ?, ?, ?, ?, NULL
        WHERE EXISTS (
          SELECT 1
          FROM openMeldDaemon_prepare_sessions
          WHERE prepare_session_id = ?
            AND owner_user_id = ?
        )
      `
    )
    .bind(
      input.tokenDigest,
      input.prepareSessionId,
      input.ownerUserId,
      input.issuedAtMs,
      input.expiresAtMs,
      input.prepareSessionId,
      input.ownerUserId
    )
    .run();

  return didWriteRows(result);
}

export async function revokePrepareSessionTokenRecords(input: {
  db: D1Database;
  prepareSessionId: string;
  ownerUserId: string;
  revokedAtMs: number;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_prepare_session_tokens
        SET revoked_at_ms = ?
        WHERE prepare_session_id = ?
          AND owner_user_id = ?
          AND revoked_at_ms IS NULL
      `
    )
    .bind(input.revokedAtMs, input.prepareSessionId, input.ownerUserId)
    .run();
}

export async function appendPrepareSessionEvent(input: {
  db: D1Database;
  ownerUserId: string;
  event: PrepareSessionEvent;
}): Promise<boolean> {
  const result = await buildAppendEventStatement(input.db, input).run();
  return didWriteRows(result);
}

export async function listPrepareSessionEvents(input: {
  db: D1Database;
  prepareSessionId: string;
  limit?: number;
}): Promise<PrepareSessionEvent[]> {
  const rows = await input.db
    .prepare(
      `
        SELECT event_id, event_json
        FROM openMeldDaemon_prepare_session_events
        WHERE prepare_session_id = ?
        ORDER BY created_at_ms ASC
        LIMIT ?
      `
    )
    .bind(input.prepareSessionId, input.limit ?? 200)
    .all<PrepareSessionEventRow>();

  return (rows.results ?? []).map(mapPrepareSessionEventRow);
}

function buildAppendEventStatement(
  db: D1Database,
  input: {
    ownerUserId: string;
    event: PrepareSessionEvent;
    requirePrepareSessionExists?: boolean;
  }
): D1PreparedStatement {
  const event = assertValidPrepareSessionEvent(input.event);
  if (input.requirePrepareSessionExists === true) {
    return db
      .prepare(
        `
          INSERT INTO openMeldDaemon_prepare_session_events (
            event_id,
            prepare_session_id,
            owner_user_id,
            session_revision,
            event_type,
            actor,
            event_json,
            created_at_ms
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1
            FROM openMeldDaemon_prepare_sessions
            WHERE prepare_session_id = ?
          )
        `
      )
      .bind(
        event.eventId,
        event.prepareSessionId,
        input.ownerUserId,
        event.sessionRevision,
        event.eventType,
        event.actor,
        JSON.stringify(event),
        Date.parse(event.createdAt),
        event.prepareSessionId
      );
  }
  return db
    .prepare(
      `
        INSERT INTO openMeldDaemon_prepare_session_events (
          event_id,
          prepare_session_id,
          owner_user_id,
          session_revision,
          event_type,
          actor,
          event_json,
          created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      event.eventId,
      event.prepareSessionId,
      input.ownerUserId,
      event.sessionRevision,
      event.eventType,
      event.actor,
      JSON.stringify(event),
      Date.parse(event.createdAt)
    );
}

function mapPrepareSessionRow(row: PrepareSessionRow): PrepareSessionRecord {
  const parsed = prepareSessionSnapshotSchema.safeParse(
    parseJsonColumn({
      id: row.prepare_session_id,
      column: "snapshot_json",
      value: row.snapshot_json,
    })
  );
  if (!parsed.success) {
    throw new Error(
      `prepare session row is invalid for ${row.prepare_session_id}: ${parsed.error.message}`
    );
  }
  return { snapshot: parsed.data };
}

function mapPrepareSessionEventRow(
  row: PrepareSessionEventRow
): PrepareSessionEvent {
  const parsed = prepareSessionEventSchema.safeParse(
    parseJsonColumn({
      id: row.event_id,
      column: "event_json",
      value: row.event_json,
    })
  );
  if (!parsed.success) {
    throw new Error(
      `prepare session event row is invalid for ${row.event_id}: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

function assertValidPrepareSessionSnapshot(
  value: PrepareSessionSnapshot
): PrepareSessionSnapshot {
  const parsed = prepareSessionSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `prepare session snapshot is invalid: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

function assertValidPrepareSessionEvent(
  value: PrepareSessionEvent
): PrepareSessionEvent {
  const parsed = prepareSessionEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `prepare session event is invalid: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

function parseJsonColumn(input: {
  id: string;
  column: "event_json" | "snapshot_json";
  value: string;
}): unknown {
  try {
    return JSON.parse(input.value) as unknown;
  } catch (error) {
    const errorMessage =
      error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : String(error);
    throw new Error(
      `failed to parse ${input.column} for prepare record ${input.id}: ${errorMessage}`
    );
  }
}

function didWriteRows(value: unknown): boolean {
  const candidate = value as {
    success?: unknown;
    meta?: { changes?: unknown };
    changes?: unknown;
  };
  if (candidate.success === false) {
    return false;
  }

  const changes = Number(candidate.meta?.changes ?? candidate.changes);
  return Number.isFinite(changes) && changes > 0;
}
