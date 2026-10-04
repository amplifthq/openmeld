import { desc } from "drizzle-orm";
import { bigint, index, text, uniqueIndex } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";

export const openMeldDaemonPrepareSessions = applicationTable(
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
    sessionRevision: bigint("session_revision", { mode: "number" }).notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    diagnosticCorrelationId: text("diagnostic_correlation_id").notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
    completedAtMs: bigint("completed_at_ms", { mode: "number" }),
    expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
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

export const openMeldDaemonPrepareSessionTokens = applicationTable(
  "openMeldDaemon_prepare_session_tokens",
  {
    tokenDigest: text("token_digest").primaryKey(),
    prepareSessionId: text("prepare_session_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    issuedAtMs: bigint("issued_at_ms", { mode: "number" }).notNull(),
    expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
    revokedAtMs: bigint("revoked_at_ms", { mode: "number" }),
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

export const openMeldDaemonPrepareSessionEvents = applicationTable(
  "openMeldDaemon_prepare_session_events",
  {
    eventId: text("event_id").primaryKey(),
    prepareSessionId: text("prepare_session_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    sessionRevision: bigint("session_revision", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    actor: text("actor").notNull(),
    eventJson: text("event_json").notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
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
