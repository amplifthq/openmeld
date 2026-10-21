import { desc, sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizations } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";
import { integerBoolean } from "../postgresql/schema-types.ts";
import { projects } from "./project.schema.ts";

export const agentActivityEvents = applicationTable(
  "agent_activity_events",
  {
    acceptedSequence: bigint("accepted_sequence", { mode: "number" })
      .generatedByDefaultAsIdentity()
      .primaryKey(),
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
    startedAtMs: bigint("started_at_ms", { mode: "number" }),
    observedAtMs: bigint("observed_at_ms", { mode: "number" }).notNull(),
    expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
    providerMetadataJson: text("provider_metadata_json").notNull(),
    acceptedAtMs: bigint("accepted_at_ms", { mode: "number" }).notNull(),
    dailySessionKey: text("daily_session_key").notNull(),
    dailyAggregatedAtMs: bigint("daily_aggregated_at_ms", { mode: "number" }),
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
    index("agent_activity_events_org_recent_idx").on(
      table.organizationId,
      table.observedAtMs.desc().nullsLast(),
      table.eventId.desc().nullsLast()
    ),
    index("agent_activity_events_org_member_observed_idx").on(
      table.organizationId,
      table.memberUserId,
      desc(table.observedAtMs)
    ),
    index("agent_activity_events_retention_idx").on(table.observedAtMs),
    index("agent_activity_events_pending_session_idx")
      .on(table.dailySessionKey)
      .where(sql`daily_aggregated_at_ms IS NULL`),
    index("agent_activity_events_daily_aggregation_idx").on(
      table.dailyAggregatedAtMs,
      table.observedAtMs
    ),
    check(
      "agent_activity_events_payload_hash_check",
      sql`length("canonical_payload_hash") = 71
        and substr("canonical_payload_hash", 1, 7) = 'sha256:'
        and substr("canonical_payload_hash", 8) !~ '^.*[^0-9a-f].*$'`
    ),
    check(
      "agent_activity_events_time_check",
      sql`"observed_at_ms" >= 0
        and "expires_at_ms" >= "observed_at_ms"
        and "accepted_at_ms" >= 0`
    ),
  ]
);

export const agentActivitySessions = applicationTable(
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
    startedAtMs: bigint("started_at_ms", { mode: "number" }),
    lastObservedAtMs: bigint("last_observed_at_ms", {
      mode: "number",
    }).notNull(),
    expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
    providerMetadataJson: text("provider_metadata_json").notNull(),
    lastEventId: text("last_event_id").notNull(),
    lastAcceptedSequence: bigint("last_accepted_sequence", {
      mode: "number",
    }).notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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
export const agentActivitySessionInventory = applicationTable(
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
    lastActiveAtMs: bigint("last_active_at_ms", { mode: "number" }).notNull(),
    startedAtMs: bigint("started_at_ms", { mode: "number" }),
    origin: text("origin").notNull(),
    canResume: integerBoolean("can_resume").notNull(),
    canFork: integerBoolean("can_fork").notNull(),
    visible: integerBoolean("visible").notNull(),
    sourceReconciliationId: text("source_reconciliation_id").notNull(),
    observedAtMs: bigint("observed_at_ms", { mode: "number" }).notNull(),
    publishedAtMs: bigint("published_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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
        and substr("local_connection_id", 8) !~ '^.*[^0-9a-f].*$'`
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
export const agentActivitySessionInventoryCandidates = applicationTable(
  "agent_activity_session_inventory_candidates",
  {
    id: text("id").primaryKey(),
    sourceScopeKey: text("source_scope_key").notNull(),
    reconciliationId: text("reconciliation_id").notNull(),
    pageIndex: bigint("page_index", { mode: "number" }).notNull(),
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
    lastActiveAtMs: bigint("last_active_at_ms", { mode: "number" }).notNull(),
    startedAtMs: bigint("started_at_ms", { mode: "number" }),
    origin: text("origin").notNull(),
    canResume: integerBoolean("can_resume").notNull(),
    canFork: integerBoolean("can_fork").notNull(),
    observedAtMs: bigint("observed_at_ms", { mode: "number" }).notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
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
export const agentActivitySessionInventorySources = applicationTable(
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
    nextPageIndex: bigint("next_page_index", { mode: "number" }).notNull(),
    problemCode: text("problem_code"),
    lastAttemptAtMs: bigint("last_attempt_at_ms", { mode: "number" }),
    lastCompleteAtMs: bigint("last_complete_at_ms", { mode: "number" }),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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
export const agentActivitySessionInventoryMemberCleanupRequests =
  applicationTable(
    "agent_activity_session_inventory_member_cleanup_requests",
    {
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      ownerUserId: text("owner_user_id").notNull(),
      requestedAtMs: bigint("requested_at_ms", { mode: "number" }).notNull(),
      lastAttemptAtMs: bigint("last_attempt_at_ms", {
        mode: "number",
      }).notNull(),
      attemptCount: bigint("attempt_count", { mode: "number" }).notNull(),
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

export const agentActivityDigests = applicationTable(
  "agent_activity_digests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    sourceCursorAcceptedSequence: bigint("source_cursor_accepted_sequence", {
      mode: "number",
    }).notNull(),
    windowStartedAtMs: bigint("window_started_at_ms", {
      mode: "number",
    }).notNull(),
    windowEndedAtMs: bigint("window_ended_at_ms", { mode: "number" }).notNull(),
    eventCount: bigint("event_count", { mode: "number" }).notNull(),
    citationsJson: text("citations_json").notNull(),
    summary: text("summary"),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
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

export const agentActivityDailyAggregates = applicationTable(
  "agent_activity_daily_aggregates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    memberUserId: text("member_user_id").notNull(),
    utcDate: text("utc_date").notNull(),
    activeDurationMs: bigint("active_duration_ms", { mode: "number" })
      .notNull()
      .default(0),
    sessionCount: bigint("session_count", { mode: "number" }).notNull(),
    eventCount: bigint("event_count", { mode: "number" }).notNull(),
    firstObservedAtMs: bigint("first_observed_at_ms", {
      mode: "number",
    }).notNull(),
    lastObservedAtMs: bigint("last_observed_at_ms", {
      mode: "number",
    }).notNull(),
    providerCountsJson: text("provider_counts_json").notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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

export const agentActivityDailySessionKeys = applicationTable(
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
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    index("agent_activity_daily_session_keys_expiry_idx").on(table.expiresAtMs),
    index("agent_activity_daily_session_keys_org_project_idx").on(
      table.organizationId,
      table.projectId
    ),
    check(
      "agent_activity_daily_session_key_hash_check",
      sql`length("daily_session_key") = 71
        and substr("daily_session_key", 1, 7) = 'sha256:'
        and substr("daily_session_key", 8) !~ '^.*[^0-9a-f].*$'
        and "expires_at_ms" >= "created_at_ms"`
    ),
  ]
);
