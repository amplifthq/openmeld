import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
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
  const results = await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: `
          INSERT INTO "openmeld"."openMeldDaemon_prepare_sessions" (
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
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ${
            requireCreatedSession
              ? "ON CONFLICT(owner_user_id, creation_idempotency_key) DO NOTHING"
              : ""
          }
        `,
          values: [
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
            expiresAtMs,
          ],
        }),
        await client.query(
          buildCreateTokenStatement({
            expiresAtMs: input.tokenExpiresAtMs,
            issuedAtMs: input.tokenIssuedAtMs,
            ownerUserId: snapshot.ownerUserId,
            prepareSessionId: snapshot.prepareSessionId,
            requireCreatedSession,
            tokenDigest: input.tokenDigest,
          })
        ),
        await client.query(
          buildAppendEventStatement({
            event,
            ownerUserId: snapshot.ownerUserId,
            requirePrepareSessionExists: requireCreatedSession,
          })
        ),
      ] as const
  );
  return didWriteRows(results[0]);
}
function buildCreateTokenStatement(input: {
  expiresAtMs: number;
  issuedAtMs: number;
  ownerUserId: string;
  prepareSessionId: string;
  requireCreatedSession: boolean;
  tokenDigest: string;
}): QueryConfig {
  if (!input.requireCreatedSession) {
    return {
      text: `
          INSERT INTO "openmeld"."openMeldDaemon_prepare_session_tokens" (
            token_digest,
            prepare_session_id,
            owner_user_id,
            issued_at_ms,
            expires_at_ms,
            revoked_at_ms
          )
          VALUES ($1, $2, $3, $4, $5, NULL)
        `,
      values: [
        input.tokenDigest,
        input.prepareSessionId,
        input.ownerUserId,
        input.issuedAtMs,
        input.expiresAtMs,
      ],
    };
  }
  return {
    text: `
        INSERT INTO "openmeld"."openMeldDaemon_prepare_session_tokens" (
          token_digest,
          prepare_session_id,
          owner_user_id,
          issued_at_ms,
          expires_at_ms,
          revoked_at_ms
        )
        SELECT $1, $2, $3, $4, $5, NULL
        WHERE EXISTS (
          SELECT 1
          FROM "openmeld"."openMeldDaemon_prepare_sessions"
          WHERE prepare_session_id = $6
        )
      `,
    values: [
      input.tokenDigest,
      input.prepareSessionId,
      input.ownerUserId,
      input.issuedAtMs,
      input.expiresAtMs,
      input.prepareSessionId,
    ],
  };
}
export async function readPrepareSessionRecord(input: {
  db: PostgresDatabase;
  prepareSessionId: string;
}): Promise<PrepareSessionRecord | null> {
  const row = await input.db
    .query<PrepareSessionRow>({
      text: `
        SELECT prepare_session_id, snapshot_json
        FROM "openmeld"."openMeldDaemon_prepare_sessions"
        WHERE prepare_session_id = $1
        LIMIT 1
      `,
      values: [input.prepareSessionId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapPrepareSessionRow(row) : null;
}
export async function readPrepareSessionRecordByTokenDigest(input: {
  db: PostgresDatabase;
  tokenDigest: string;
  nowMs: number;
}): Promise<PrepareSessionRecord | null> {
  const row = await input.db
    .query<PrepareSessionRow>({
      text: `
        SELECT s.prepare_session_id, s.snapshot_json
        FROM "openmeld"."openMeldDaemon_prepare_session_tokens" t
        INNER JOIN "openmeld"."openMeldDaemon_prepare_sessions" s
          ON s.prepare_session_id = t.prepare_session_id
        WHERE t.token_digest = $1
          AND t.revoked_at_ms IS NULL
          AND t.expires_at_ms > $2
        LIMIT 1
      `,
      values: [input.tokenDigest, input.nowMs],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapPrepareSessionRow(row) : null;
}
export async function updatePrepareSessionSnapshotIfRevision(input: {
  db: PostgresDatabase;
  expectedRevision: number;
  snapshot: PrepareSessionSnapshot;
}): Promise<CompareAndSetPrepareSessionResult> {
  const snapshot = assertValidPrepareSessionSnapshot(input.snapshot);
  const completedAtMs =
    snapshot.completedAt === null ? null : Date.parse(snapshot.completedAt);
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldDaemon_prepare_sessions"
        SET human_profile_id = $1,
            device_id = $2,
            runtime_lane = $3,
            target_space_id = $4,
            lifecycle_status = $5,
            phase = $6,
            session_revision = $7,
            snapshot_json = $8,
            diagnostic_correlation_id = $9,
            updated_at_ms = $10,
            completed_at_ms = $11,
            expires_at_ms = $12
        WHERE prepare_session_id = $13
          AND session_revision = $14
      `,
    values: [
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
      input.expectedRevision,
    ],
  });
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
  db: PostgresDatabase;
  prepareSessionId: string;
  ownerUserId: string;
  tokenDigest: string;
  issuedAtMs: number;
  expiresAtMs: number;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldDaemon_prepare_session_tokens" (
          token_digest,
          prepare_session_id,
          owner_user_id,
          issued_at_ms,
          expires_at_ms,
          revoked_at_ms
        )
        SELECT $1, $2, $3, $4, $5, NULL
        WHERE EXISTS (
          SELECT 1
          FROM "openmeld"."openMeldDaemon_prepare_sessions"
          WHERE prepare_session_id = $6
            AND owner_user_id = $7
        )
      `,
    values: [
      input.tokenDigest,
      input.prepareSessionId,
      input.ownerUserId,
      input.issuedAtMs,
      input.expiresAtMs,
      input.prepareSessionId,
      input.ownerUserId,
    ],
  });
  return didWriteRows(result);
}
export async function revokePrepareSessionTokenRecords(input: {
  db: PostgresDatabase;
  prepareSessionId: string;
  ownerUserId: string;
  revokedAtMs: number;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldDaemon_prepare_session_tokens"
        SET revoked_at_ms = $1
        WHERE prepare_session_id = $2
          AND owner_user_id = $3
          AND revoked_at_ms IS NULL
      `,
    values: [input.revokedAtMs, input.prepareSessionId, input.ownerUserId],
  });
}
export async function appendPrepareSessionEvent(input: {
  db: PostgresDatabase;
  ownerUserId: string;
  event: PrepareSessionEvent;
}): Promise<boolean> {
  const result = await input.db.query(buildAppendEventStatement(input));
  return didWriteRows(result);
}
export async function listPrepareSessionEvents(input: {
  db: PostgresDatabase;
  prepareSessionId: string;
  limit?: number;
}): Promise<PrepareSessionEvent[]> {
  const rows = await input.db.query<PrepareSessionEventRow>({
    text: `
        SELECT event_id, event_json
        FROM "openmeld"."openMeldDaemon_prepare_session_events"
        WHERE prepare_session_id = $1
        ORDER BY created_at_ms ASC NULLS FIRST
        LIMIT $2
      `,
    values: [input.prepareSessionId, input.limit ?? 200],
  });
  return (rows.rows ?? []).map(mapPrepareSessionEventRow);
}
function buildAppendEventStatement(input: {
  ownerUserId: string;
  event: PrepareSessionEvent;
  requirePrepareSessionExists?: boolean;
}): QueryConfig {
  const event = assertValidPrepareSessionEvent(input.event);
  if (input.requirePrepareSessionExists === true) {
    return {
      text: `
          INSERT INTO "openmeld"."openMeldDaemon_prepare_session_events" (
            event_id,
            prepare_session_id,
            owner_user_id,
            session_revision,
            event_type,
            actor,
            event_json,
            created_at_ms
          )
          SELECT $1, $2, $3, $4, $5, $6, $7, $8
          WHERE EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldDaemon_prepare_sessions"
            WHERE prepare_session_id = $9
          )
        `,
      values: [
        event.eventId,
        event.prepareSessionId,
        input.ownerUserId,
        event.sessionRevision,
        event.eventType,
        event.actor,
        JSON.stringify(event),
        Date.parse(event.createdAt),
        event.prepareSessionId,
      ],
    };
  }
  return {
    text: `
        INSERT INTO "openmeld"."openMeldDaemon_prepare_session_events" (
          event_id,
          prepare_session_id,
          owner_user_id,
          session_revision,
          event_type,
          actor,
          event_json,
          created_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
    values: [
      event.eventId,
      event.prepareSessionId,
      input.ownerUserId,
      event.sessionRevision,
      event.eventType,
      event.actor,
      JSON.stringify(event),
      Date.parse(event.createdAt),
    ],
  };
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
    rowCount?: unknown;
  };
  const changes = Number(candidate.rowCount);
  return Number.isFinite(changes) && changes > 0;
}
