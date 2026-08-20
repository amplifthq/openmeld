import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations } from "../auth/auth.schema.ts";
import { projects } from "./project.schema.ts";

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

/**
 * Core-owned current Session Inventory. Historical Activity evidence remains in
 * agent_activity_events; this projection is replaced only after a complete
 * provider/Project/Computer reconciliation is accepted.
 */
export const agentActivitySessionInventory = sqliteTable(
  "agent_activity_session_inventory",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull(),
    agentControllerRef: text("agent_controller_ref").notNull(),
    nativeSessionId: text("native_session_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    connectedComputerId: text("connected_computer_id").notNull(),
    localConnectionId: text("local_connection_id").notNull(),
    sourceScopeKey: text("source_scope_key").notNull(),
    provider: text("provider").notNull(),
    nativeSessionTitle: text("native_session_title"),
    status: text("status").notNull(),
    lastActiveAtMs: integer("last_active_at_ms").notNull(),
    startedAtMs: integer("started_at_ms"),
    origin: text("origin").notNull(),
    canResume: integer("can_resume", { mode: "boolean" }).notNull(),
    canFork: integer("can_fork", { mode: "boolean" }).notNull(),
    visible: integer("visible", { mode: "boolean" }).notNull(),
    sourceReconciliationId: text("source_reconciliation_id").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
    publishedAtMs: integer("published_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_activity_session_inventory_identity_unique").on(
      table.organizationId,
      table.ownerUserId,
      table.agentControllerRef,
      table.nativeSessionId
    ),
    index("agent_activity_session_inventory_org_page_idx").on(
      table.organizationId,
      table.visible,
      desc(table.lastActiveAtMs),
      table.ownerUserId,
      table.agentControllerRef,
      table.nativeSessionId
    ),
    index("agent_activity_session_inventory_source_idx").on(
      table.sourceScopeKey,
      table.visible,
      table.sourceReconciliationId
    ),
    index("agent_activity_session_inventory_project_idx").on(
      table.organizationId,
      table.projectId,
      table.visible,
      desc(table.lastActiveAtMs)
    ),
    check(
      "agent_activity_session_inventory_connection_hash_check",
      sql`length("local_connection_id") = 71
        and substr("local_connection_id", 1, 7) = 'sha256:'
        and substr("local_connection_id", 8) not glob '*[^0-9a-f]*'`
    ),
    check(
      "agent_activity_session_inventory_time_check",
      sql`"last_active_at_ms" >= 0
        and ("started_at_ms" is null or "started_at_ms" <= "last_active_at_ms")
        and "published_at_ms" >= 0
        and "updated_at_ms" >= "published_at_ms"`
    ),
    check(
      "agent_activity_session_inventory_status_check",
      sql`"status" in ('working', 'idle', 'ended', 'error', 'unknown')`
    ),
    check(
      "agent_activity_session_inventory_origin_check",
      sql`"origin" in ('openmeld', 'local', 'unknown')`
    ),
  ]
);

/** Staging rows are never user-readable and are discarded after publication. */
export const agentActivitySessionInventoryCandidates = sqliteTable(
  "agent_activity_session_inventory_candidates",
  {
    id: text("id").primaryKey(),
    sourceScopeKey: text("source_scope_key").notNull(),
    reconciliationId: text("reconciliation_id").notNull(),
    pageIndex: integer("page_index").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull(),
    agentControllerRef: text("agent_controller_ref").notNull(),
    nativeSessionId: text("native_session_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    connectedComputerId: text("connected_computer_id").notNull(),
    localConnectionId: text("local_connection_id").notNull(),
    provider: text("provider").notNull(),
    nativeSessionTitle: text("native_session_title"),
    status: text("status").notNull(),
    lastActiveAtMs: integer("last_active_at_ms").notNull(),
    startedAtMs: integer("started_at_ms"),
    origin: text("origin").notNull(),
    canResume: integer("can_resume", { mode: "boolean" }).notNull(),
    canFork: integer("can_fork", { mode: "boolean" }).notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_activity_session_candidates_identity_unique").on(
      table.sourceScopeKey,
      table.reconciliationId,
      table.agentControllerRef,
      table.nativeSessionId
    ),
    index("agent_activity_session_candidates_page_idx").on(
      table.sourceScopeKey,
      table.reconciliationId,
      table.pageIndex
    ),
    check(
      "agent_activity_session_candidates_time_check",
      sql`"page_index" >= 0
        and "last_active_at_ms" >= 0
        and ("started_at_ms" is null or "started_at_ms" <= "last_active_at_ms")
        and "created_at_ms" >= 0`
    ),
  ]
);

/** One reconciliation cursor and coverage fact per authorized local source. */
export const agentActivitySessionInventorySources = sqliteTable(
  "agent_activity_session_inventory_sources",
  {
    sourceScopeKey: text("source_scope_key").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    connectedComputerId: text("connected_computer_id").notNull(),
    localConnectionId: text("local_connection_id").notNull(),
    agentControllerRef: text("agent_controller_ref").notNull(),
    provider: text("provider").notNull(),
    state: text("state").notNull(),
    currentReconciliationId: text("current_reconciliation_id"),
    nextPageIndex: integer("next_page_index").notNull(),
    problemCode: text("problem_code"),
    lastAttemptAtMs: integer("last_attempt_at_ms"),
    lastCompleteAtMs: integer("last_complete_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_activity_session_sources_scope_unique").on(
      table.organizationId,
      table.ownerUserId,
      table.deviceId,
      table.projectId,
      table.localConnectionId,
      table.agentControllerRef
    ),
    index("agent_activity_session_sources_org_state_idx").on(
      table.organizationId,
      table.state,
      desc(table.updatedAtMs)
    ),
    check(
      "agent_activity_session_sources_state_check",
      sql`"state" in (
        'waiting', 'syncing', 'current', 'stale', 'unsupported', 'error', 'disconnected'
      )`
    ),
    check(
      "agent_activity_session_sources_cursor_check",
      sql`"next_page_index" >= 0
        and "updated_at_ms" >= 0
        and (
          ("state" = 'syncing' and "current_reconciliation_id" is not null)
          or ("state" <> 'syncing')
        )`
    ),
  ]
);

/**
 * Durable cleanup intent accepted before Auth removes an Organization member.
 * Core keeps the request until membership absence is observed and every
 * current/staged Session projection has been purged again after that boundary.
 */
export const agentActivitySessionInventoryMemberCleanupRequests = sqliteTable(
  "agent_activity_session_inventory_member_cleanup_requests",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull(),
    requestedAtMs: integer("requested_at_ms").notNull(),
    lastAttemptAtMs: integer("last_attempt_at_ms").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    lastError: text("last_error"),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.ownerUserId],
      name: "agent_activity_session_inventory_member_cleanup_requests_pk",
    }),
    index("agent_activity_session_inventory_member_cleanup_due_idx").on(
      table.lastAttemptAtMs,
      table.requestedAtMs
    ),
    check(
      "agent_activity_session_inventory_member_cleanup_time_check",
      sql`"requested_at_ms" >= 0
        and "last_attempt_at_ms" >= "requested_at_ms"
        and "attempt_count" >= 0`
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
