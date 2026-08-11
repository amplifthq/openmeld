import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

export const centerAgentTasks = sqliteTable(
  "center_agent_tasks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    title: text("title").notNull(),
    goal: text("goal").notNull(),
    originKind: text("origin_kind").notNull(),
    originDestinationJson: text("origin_destination_json"),
    originAttributionJson: text("origin_attribution_json"),
    status: text("status").default("queued").notNull(),
    activeAttemptGeneration: integer("active_attempt_generation"),
    version: integer("version").default(1).notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    finishedAtMs: integer("finished_at_ms"),
  },
  (table) => [
    uniqueIndex("center_agent_tasks_org_requester_idempotency_unique").on(
      table.organizationId,
      table.requesterUserId,
      table.idempotencyKey
    ),
    index("center_agent_tasks_requester_updated_idx").on(
      table.organizationId,
      table.requesterUserId,
      table.updatedAtMs,
      table.id
    ),
    index("center_agent_tasks_org_status_updated_idx").on(
      table.organizationId,
      table.status,
      table.updatedAtMs
    ),
    check(
      "center_agent_tasks_status_check",
      sql`"status" in ('queued', 'running', 'stopping', 'needs_attention', 'succeeded', 'failed', 'stopped')`
    ),
    check(
      "center_agent_tasks_origin_check",
      sql`("origin_kind" = 'open_meld' and "origin_destination_json" is null)
        or ("origin_kind" = 'message_channel' and "origin_destination_json" is not null and json_valid("origin_destination_json"))`
    ),
    check(
      "center_agent_tasks_origin_attribution_check",
      sql`"origin_attribution_json" is null or json_valid("origin_attribution_json")`
    ),
    check(
      "center_agent_tasks_active_generation_check",
      sql`"active_attempt_generation" is null or "active_attempt_generation" > 0`
    ),
    check(
      "center_agent_tasks_nonqueued_generation_check",
      sql`"status" = 'queued' or "active_attempt_generation" is not null`
    ),
    check("center_agent_tasks_version_check", sql`"version" > 0`),
    check(
      "center_agent_tasks_lifecycle_check",
      sql`("status" in ('queued', 'running', 'stopping', 'needs_attention') and "finished_at_ms" is null)
        or ("status" in ('succeeded', 'failed', 'stopped') and "finished_at_ms" is not null)`
    ),
    check(
      "center_agent_tasks_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
    check(
      "center_agent_tasks_finished_at_check",
      sql`"finished_at_ms" is null or "finished_at_ms" >= "created_at_ms"`
    ),
    check(
      "center_agent_tasks_title_non_empty_check",
      sql`length(trim("title")) > 0`
    ),
    check(
      "center_agent_tasks_goal_non_empty_check",
      sql`length(trim("goal")) > 0`
    ),
  ]
);

// Task owns this current-read authorization projection. Inbox and other
// consumers may join it, but they never reconstruct Task access from copied
// source metadata or private Task rows.
export const centerAgentTaskAuthorizedReaders = sqliteTable(
  "center_agent_task_authorized_readers",
  {
    taskId: text("task_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessScope: text("access_scope").default("requester_private").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userId] }),
    index("center_agent_task_authorized_readers_user_idx").on(
      table.organizationId,
      table.userId,
      table.taskId
    ),
    check(
      "center_agent_task_authorized_readers_scope_check",
      sql`"access_scope" = 'requester_private'`
    ),
    check(
      "center_agent_task_authorized_readers_updated_at_check",
      sql`"updated_at_ms" >= 0`
    ),
  ]
);

export const centerAgentTaskAttempts = sqliteTable(
  "center_agent_task_attempts",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => centerAgentTasks.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    generation: integer("generation").notNull(),
    executionTaskKey: text("execution_task_key").notNull(),
    taskHandleJson: text("task_handle_json").notNull(),
    status: text("status").default("queued").notNull(),
    failureCode: text("failure_code"),
    createdAtMs: integer("created_at_ms").notNull(),
    startedAtMs: integer("started_at_ms"),
    finishedAtMs: integer("finished_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_task_attempts_task_generation_unique").on(
      table.taskId,
      table.generation
    ),
    uniqueIndex("center_agent_task_attempts_task_idempotency_unique").on(
      table.taskId,
      table.idempotencyKey
    ),
    uniqueIndex("center_agent_task_attempts_execution_task_unique").on(
      table.executionTaskKey
    ),
    index("center_agent_task_attempts_task_generation_idx").on(
      table.taskId,
      table.generation
    ),
    check("center_agent_task_attempts_generation_check", sql`"generation" > 0`),
    check(
      "center_agent_task_attempts_status_check",
      sql`"status" in ('queued', 'running', 'stopping', 'needs_attention', 'succeeded', 'failed', 'stopped')`
    ),
    check(
      "center_agent_task_attempts_lifecycle_check",
      sql`("status" = 'queued' and "started_at_ms" is null and "finished_at_ms" is null)
        or ("status" in ('running', 'stopping', 'needs_attention') and "started_at_ms" is not null and "finished_at_ms" is null)
        or ("status" in ('succeeded', 'failed', 'stopped') and "started_at_ms" is not null and "finished_at_ms" is not null and "finished_at_ms" >= "started_at_ms")`
    ),
    check(
      "center_agent_task_attempts_failure_check",
      sql`("status" = 'failed' and "failure_code" is not null)
        or ("status" != 'failed' and "failure_code" is null)`
    ),
    check(
      "center_agent_task_attempts_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const centerAgentTaskAdmissionOutbox = sqliteTable(
  "center_agent_task_admission_outbox",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => centerAgentTasks.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    attemptGeneration: integer("attempt_generation").notNull(),
    deliveryId: text("delivery_id").notNull(),
    operationIdempotencyKey: text("operation_idempotency_key").notNull(),
    taskEventId: text("task_event_id").notNull(),
    requesterUserId: text("requester_user_id").notNull(),
    instruction: text("instruction").notNull(),
    parentKind: text("parent_kind").notNull(),
    parentId: text("parent_id").notNull(),
    state: text("state").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastAttemptAtMs: integer("last_attempt_at_ms"),
    lastFailureCode: text("last_failure_code"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_task_admission_outbox_task_attempt_unique").on(
      table.taskId,
      table.attemptGeneration
    ),
    uniqueIndex("center_agent_task_admission_outbox_delivery_unique").on(
      table.deliveryId
    ),
    index("center_agent_task_admission_outbox_pending_idx").on(
      table.state,
      table.updatedAtMs,
      table.taskId
    ),
    check(
      "center_agent_task_admission_outbox_generation_check",
      sql`"attempt_generation" > 0`
    ),
    check(
      "center_agent_task_admission_outbox_parent_kind_check",
      sql`"parent_kind" in ('delivery', 'submission')`
    ),
    check(
      "center_agent_task_admission_outbox_state_check",
      sql`"state" in ('pending', 'delivered', 'failed')`
    ),
    check(
      "center_agent_task_admission_outbox_attempt_count_check",
      sql`"attempt_count" >= 0`
    ),
    check(
      "center_agent_task_admission_outbox_instruction_non_empty_check",
      sql`length(trim("instruction")) > 0`
    ),
    check(
      "center_agent_task_admission_outbox_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const centerAgentTaskEvents = sqliteTable(
  "center_agent_task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => centerAgentTasks.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    attemptGeneration: integer("attempt_generation"),
    kind: text("kind").notNull(),
    actor: text("actor").notNull(),
    text: text("text").notNull(),
    occurredAtMs: integer("occurred_at_ms").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_task_events_task_idempotency_unique").on(
      table.taskId,
      table.idempotencyKey
    ),
    index("center_agent_task_events_task_occurred_idx").on(
      table.taskId,
      table.occurredAtMs,
      table.observedAtMs,
      table.id
    ),
    check(
      "center_agent_task_events_attempt_generation_check",
      sql`"attempt_generation" is null or "attempt_generation" > 0`
    ),
    check(
      "center_agent_task_events_kind_check",
      sql`"kind" in ('task_created', 'requester_message', 'center_agent_update', 'needs_attention', 'stop_requested', 'task_succeeded', 'task_failed', 'task_stopped')`
    ),
    check(
      "center_agent_task_events_actor_check",
      sql`"actor" in ('requester', 'center_agent', 'system')`
    ),
    check(
      "center_agent_task_events_text_non_empty_check",
      sql`length(trim("text")) > 0`
    ),
    check(
      "center_agent_task_events_observed_at_check",
      sql`"observed_at_ms" >= "occurred_at_ms"`
    ),
  ]
);
