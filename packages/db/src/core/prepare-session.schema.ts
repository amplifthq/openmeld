import { desc } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const openMeldDaemonPrepareSessions = sqliteTable(
  "openMeldDaemon_prepare_sessions",
  {
    prepareSessionId: text("prepare_session_id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    humanProfileId: text("human_profile_id"),
    deviceId: text("device_id"),
    runtimeLane: text("runtime_lane"),
    targetSpaceId: text("target_space_id"),
    creationIdempotencyKey: text("creation_idempotency_key"),
    lifecycleStatus: text("lifecycle_status").notNull(),
    phase: text("phase").notNull(),
    sessionRevision: integer("session_revision").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    diagnosticCorrelationId: text("diagnostic_correlation_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    completedAtMs: integer("completed_at_ms"),
    expiresAtMs: integer("expires_at_ms").notNull(),
  },
  (table) => [
    index("idx_openMeldDaemon_prepare_sessions_owner_status_updated").on(
      table.ownerUserId,
      table.lifecycleStatus,
      desc(table.updatedAtMs)
    ),
    index("idx_openMeldDaemon_prepare_sessions_device_status_updated").on(
      table.ownerUserId,
      table.deviceId,
      table.lifecycleStatus,
      desc(table.updatedAtMs)
    ),
    index("idx_openMeldDaemon_prepare_sessions_expires").on(table.expiresAtMs),
    uniqueIndex(
      "idx_openMeldDaemon_prepare_sessions_owner_creation_idempotency"
    ).on(table.ownerUserId, table.creationIdempotencyKey),
  ]
);

export const openMeldDaemonPrepareSessionTokens = sqliteTable(
  "openMeldDaemon_prepare_session_tokens",
  {
    tokenDigest: text("token_digest").primaryKey(),
    prepareSessionId: text("prepare_session_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    issuedAtMs: integer("issued_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    revokedAtMs: integer("revoked_at_ms"),
  },
  (table) => [
    index("idx_openMeldDaemon_prepare_session_tokens_session_active").on(
      table.prepareSessionId,
      table.revokedAtMs
    ),
    index("idx_openMeldDaemon_prepare_session_tokens_owner_issued").on(
      table.ownerUserId,
      desc(table.issuedAtMs)
    ),
  ]
);

export const openMeldDaemonPrepareSessionEvents = sqliteTable(
  "openMeldDaemon_prepare_session_events",
  {
    eventId: text("event_id").primaryKey(),
    prepareSessionId: text("prepare_session_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    sessionRevision: integer("session_revision").notNull(),
    eventType: text("event_type").notNull(),
    actor: text("actor").notNull(),
    eventJson: text("event_json").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    index("idx_openMeldDaemon_prepare_session_events_session_created").on(
      table.prepareSessionId,
      table.createdAtMs
    ),
    index("idx_openMeldDaemon_prepare_session_events_owner_created").on(
      table.ownerUserId,
      desc(table.createdAtMs)
    ),
  ]
);
