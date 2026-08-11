import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations } from "../auth/auth.schema.ts";

export const agentActivityEvents = sqliteTable(
  "agent_activity_events",
  {
    acceptedSequence: integer("accepted_sequence").primaryKey({
      autoIncrement: true,
    }),
    id: text("id").notNull(),
    eventId: text("event_id").notNull(),
    canonicalPayloadHash: text("canonical_payload_hash").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    memberUserId: text("member_user_id").notNull(),
    deviceId: text("device_id").notNull(),
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").notNull(),
    provider: text("provider").notNull(),
    clientKind: text("client_kind").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    eventType: text("event_type").notNull(),
    title: text("title"),
    model: text("model"),
    status: text("status").notNull(),
    gitBranch: text("git_branch"),
    gitCommit: text("git_commit"),
    repositoryFingerprint: text("repository_fingerprint"),
    startedAtMs: integer("started_at_ms"),
    observedAtMs: integer("observed_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    providerMetadataJson: text("provider_metadata_json").notNull(),
    acceptedAtMs: integer("accepted_at_ms").notNull(),
    dailySessionKey: text("daily_session_key").notNull(),
    dailyAggregatedAtMs: integer("daily_aggregated_at_ms"),
  },
  (table) => [
    uniqueIndex("agent_activity_events_storage_id_unique").on(table.id),
    uniqueIndex("agent_activity_events_org_event_unique").on(
      table.organizationId,
      table.eventId
    ),
    index("agent_activity_events_org_project_observed_idx").on(
      table.organizationId,
      table.projectId,
      desc(table.observedAtMs)
    ),
    index("agent_activity_events_org_member_observed_idx").on(
      table.organizationId,
      table.memberUserId,
      desc(table.observedAtMs)
    ),
    index("agent_activity_events_retention_idx").on(table.observedAtMs),
    index("agent_activity_events_daily_aggregation_idx").on(
      table.dailyAggregatedAtMs,
      table.observedAtMs
    ),
    check(
      "agent_activity_events_payload_hash_check",
      sql`length("canonical_payload_hash") = 71
        and substr("canonical_payload_hash", 1, 7) = 'sha256:'
        and substr("canonical_payload_hash", 8) not glob '*[^0-9a-f]*'`
    ),
    check(
      "agent_activity_events_time_check",
      sql`"observed_at_ms" >= 0
        and "expires_at_ms" >= "observed_at_ms"
        and "accepted_at_ms" >= 0`
    ),
  ]
);

export const agentActivitySessions = sqliteTable(
  "agent_activity_sessions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    memberUserId: text("member_user_id").notNull(),
    deviceId: text("device_id").notNull(),
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").notNull(),
    provider: text("provider").notNull(),
    clientKind: text("client_kind").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    title: text("title"),
    model: text("model"),
    status: text("status").notNull(),
    gitBranch: text("git_branch"),
    gitCommit: text("git_commit"),
    repositoryFingerprint: text("repository_fingerprint"),
    startedAtMs: integer("started_at_ms"),
    lastObservedAtMs: integer("last_observed_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    providerMetadataJson: text("provider_metadata_json").notNull(),
    lastEventId: text("last_event_id").notNull(),
    lastAcceptedSequence: integer("last_accepted_sequence").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_activity_sessions_identity_unique").on(
      table.organizationId,
      table.memberUserId,
      table.deviceId,
      table.provider,
      table.providerSessionId
    ),
    index("agent_activity_sessions_org_active_idx").on(
      table.organizationId,
      desc(table.expiresAtMs)
    ),
    index("agent_activity_sessions_org_project_active_idx").on(
      table.organizationId,
      table.projectId,
      desc(table.expiresAtMs)
    ),
    index("agent_activity_sessions_expiry_idx").on(table.expiresAtMs),
    check(
      "agent_activity_sessions_time_check",
      sql`"last_observed_at_ms" >= 0
        and "expires_at_ms" >= "last_observed_at_ms"
        and "last_accepted_sequence" > 0
        and "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const agentActivityDigests = sqliteTable(
  "agent_activity_digests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    sourceCursorAcceptedSequence: integer(
      "source_cursor_accepted_sequence"
    ).notNull(),
    windowStartedAtMs: integer("window_started_at_ms").notNull(),
    windowEndedAtMs: integer("window_ended_at_ms").notNull(),
    eventCount: integer("event_count").notNull(),
    citationsJson: text("citations_json").notNull(),
    summary: text("summary"),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    createdAtMs: integer("created_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_activity_digests_source_cursor_unique").on(
      table.organizationId,
      table.projectId,
      table.sourceCursorAcceptedSequence
    ),
    index("agent_activity_digests_org_created_idx").on(
      table.organizationId,
      desc(table.createdAtMs)
    ),
    index("agent_activity_digests_expiry_idx").on(table.expiresAtMs),
    check(
      "agent_activity_digests_window_check",
      sql`"window_ended_at_ms" >= "window_started_at_ms"
        and "source_cursor_accepted_sequence" > 0
        and "event_count" > 0
        and "expires_at_ms" >= "created_at_ms"`
    ),
    check(
      "agent_activity_digests_status_check",
      sql`("status" = 'pending' and "summary" is null and "failure_reason" is null)
        or ("status" = 'completed' and "summary" is not null and "failure_reason" is null)
        or ("status" = 'failed' and "summary" is null and "failure_reason" is not null)`
    ),
  ]
);

export const agentActivityDailyAggregates = sqliteTable(
  "agent_activity_daily_aggregates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    memberUserId: text("member_user_id").notNull(),
    utcDate: text("utc_date").notNull(),
    activeDurationMs: integer("active_duration_ms").notNull().default(0),
    sessionCount: integer("session_count").notNull(),
    eventCount: integer("event_count").notNull(),
    firstObservedAtMs: integer("first_observed_at_ms").notNull(),
    lastObservedAtMs: integer("last_observed_at_ms").notNull(),
    providerCountsJson: text("provider_counts_json").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_activity_daily_scope_unique").on(
      table.organizationId,
      table.projectId,
      table.memberUserId,
      table.utcDate
    ),
    index("agent_activity_daily_org_date_idx").on(
      table.organizationId,
      desc(table.utcDate)
    ),
    check(
      "agent_activity_daily_active_duration_check",
      sql`"active_duration_ms" >= 0`
    ),
    check(
      "agent_activity_daily_counts_check",
      sql`"session_count" >= 0
        and "event_count" >= 0
        and "last_observed_at_ms" >= "first_observed_at_ms"`
    ),
  ]
);

export const agentActivityDailySessionKeys = sqliteTable(
  "agent_activity_daily_session_keys",
  {
    dailySessionKey: text("daily_session_key").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    memberUserId: text("member_user_id").notNull(),
    utcDate: text("utc_date").notNull(),
    firstEventStorageId: text("first_event_storage_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
  },
  (table) => [
    index("agent_activity_daily_session_keys_expiry_idx").on(table.expiresAtMs),
    check(
      "agent_activity_daily_session_key_hash_check",
      sql`length("daily_session_key") = 71
        and substr("daily_session_key", 1, 7) = 'sha256:'
        and substr("daily_session_key", 8) not glob '*[^0-9a-f]*'
        and "expires_at_ms" >= "created_at_ms"`
    ),
  ]
);
