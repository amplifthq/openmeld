import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

export const agentProfileCreationApprovalPreferences = sqliteTable(
  "agent_profile_creation_approval_preferences",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    newSessionPolicy: text("new_session_policy")
      .default("ask_every_time")
      .notNull(),
    existingSessionPolicy: text("existing_session_policy")
      .default("ask_every_time")
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_profile_creation_approval_prefs_org_user_uq_idx").on(
      table.organizationId,
      table.userId
    ),
    index("agent_profile_creation_approval_prefs_user_idx").on(table.userId),
    check(
      "agent_profile_creation_approval_prefs_policy_check",
      sql`"new_session_policy" in ('never_allow', 'ask_every_time', 'automatically_allow') and "existing_session_policy" in ('never_allow', 'ask_every_time', 'automatically_allow')`
    ),
  ]
);

export const agentProfileCreationRequests = sqliteTable(
  "agent_profile_creation_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id").notNull(),
    targetOwnerUserId: text("target_owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    profileName: text("profile_name").notNull(),
    configurationJson: text("configuration_json")
      .default(
        '{"agentControllerPermissionMode":null,"agentControllerRef":null,"authorizeForOrganization":true,"defaultProjectId":null,"modelId":null,"openCodePermission":null,"reasoningLevel":null,"targetComputerId":null}'
      )
      .notNull(),
    sessionStrategy: text("session_strategy").notNull(),
    nativeSessionId: text("native_session_id"),
    requestedSpaceId: text("requested_space_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    statusReason: text("status_reason").notNull(),
    createdAgentProfileId: text("created_agent_profile_id"),
    failureMessage: text("failure_message"),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_profile_creation_requests_requester_key_uq_idx").on(
      table.organizationId,
      table.requesterUserId,
      table.idempotencyKey
    ),
    index("agent_profile_creation_requests_requester_status_idx").on(
      table.organizationId,
      table.requesterUserId,
      table.status,
      table.updatedAt
    ),
    index("agent_profile_creation_requests_target_status_idx").on(
      table.organizationId,
      table.targetOwnerUserId,
      table.status,
      table.updatedAt
    ),
    check(
      "agent_profile_creation_requests_source_check",
      sql`"source" in ('web', 'cli', 'local_agent', 'center_agent')`
    ),
    check(
      "agent_profile_creation_requests_strategy_check",
      sql`"session_strategy" in ('new', 'resume', 'fork')`
    ),
    check(
      "agent_profile_creation_requests_session_check",
      sql`("session_strategy" = 'new' and "native_session_id" is null) or ("session_strategy" in ('resume', 'fork') and "native_session_id" is not null and length(trim("native_session_id")) > 0)`
    ),
    check(
      "agent_profile_creation_requests_status_check",
      sql`"status" in ('pending', 'approved', 'declined', 'cancelled', 'completed', 'failed')`
    ),
    check(
      "agent_profile_creation_requests_status_reason_check",
      sql`"status_reason" in ('approval_required', 'automatically_allowed', 'self_request', 'target_policy_denied', 'target_approved', 'target_declined', 'requester_cancelled', 'profile_created', 'profile_creation_failed')`
    ),
    check(
      "agent_profile_creation_requests_completion_check",
      sql`("status" = 'completed' and "created_agent_profile_id" is not null and "completed_at" is not null) or ("status" = 'failed' and "completed_at" is null) or ("status" not in ('completed', 'failed') and "created_agent_profile_id" is null and "completed_at" is null)`
    ),
    check(
      "agent_profile_creation_requests_failure_check",
      sql`("status" = 'failed' and "failure_message" is not null and length(trim("failure_message")) > 0) or ("status" != 'failed' and "failure_message" is null)`
    ),
    check(
      "agent_profile_creation_requests_required_text_check",
      sql`length(trim("id")) > 0 and length(trim("actor_profile_id")) > 0 and length(trim("profile_name")) > 0 and length(trim("idempotency_key")) > 0`
    ),
  ]
);
