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

export const routines = sqliteTable(
  "routines",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    instructions: text("instructions").notNull(),
    authorizedActionsJson: text("authorized_actions_json")
      .default("[]")
      .notNull(),
    externalActionPolicy: text("external_action_policy")
      .default("standard")
      .notNull(),
    scheduleKind: text("schedule_kind").default("cron").notNull(),
    cronExpression: text("cron_expression"),
    timezone: text("timezone"),
    runAtMs: integer("run_at_ms"),
    destinationKind: text("destination_kind").default("space").notNull(),
    targetSpaceId: text("target_space_id"),
    slackTeamId: text("slack_team_id"),
    slackChannelId: text("slack_channel_id"),
    slackThreadTs: text("slack_thread_ts"),
    slackConversationId: text("slack_conversation_id"),
    slackThreadLabel: text("slack_thread_label"),
    status: text("status").default("enabled").notNull(),
    nextDueAt: integer("next_due_at"),
    createdByUserId: text("created_by_user_id").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("routines_status_next_due_idx").on(table.status, table.nextDueAt),
    index("routines_org_status_next_due_idx").on(
      table.organizationId,
      table.status,
      table.nextDueAt
    ),
    index("routines_org_updated_idx").on(
      table.organizationId,
      desc(table.updatedAtMs)
    ),
    check("routines_id_non_empty_check", sql`length(trim("id")) > 0`),
    check(
      "routines_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check("routines_name_non_empty_check", sql`length(trim("name")) > 0`),
    check(
      "routines_instructions_non_empty_check",
      sql`length(trim("instructions")) > 0`
    ),
    check(
      "routines_external_action_policy_check",
      sql`"external_action_policy" in ('standard', 'read_only')`
    ),
    check(
      "routines_schedule_kind_check",
      sql`"schedule_kind" in ('cron', 'once')`
    ),
    check(
      "routines_cron_expression_non_empty_check",
      sql`"cron_expression" is null or length(trim("cron_expression")) > 0`
    ),
    check(
      "routines_timezone_non_empty_check",
      sql`"timezone" is null or length(trim("timezone")) > 0`
    ),
    check(
      "routines_schedule_fields_check",
      sql`("schedule_kind" = 'cron' and "cron_expression" is not null and "timezone" is not null and "run_at_ms" is null) or ("schedule_kind" = 'once' and "cron_expression" is null and "timezone" is null and "run_at_ms" is not null)`
    ),
    check(
      "routines_destination_kind_check",
      sql`"destination_kind" in ('space', 'slack_thread')`
    ),
    check(
      "routines_target_space_non_empty_check",
      sql`"target_space_id" is null or length(trim("target_space_id")) > 0`
    ),
    check(
      "routines_destination_fields_check",
      sql`("destination_kind" = 'space' and "target_space_id" is not null and "slack_team_id" is null and "slack_channel_id" is null and "slack_thread_ts" is null and "slack_conversation_id" is null) or ("destination_kind" = 'slack_thread' and "target_space_id" is null and "slack_team_id" is not null and "slack_channel_id" is not null and "slack_thread_ts" is not null and "slack_conversation_id" is not null)`
    ),
    check(
      "routines_status_check",
      sql`"status" in ('enabled', 'paused', 'completed')`
    ),
    check(
      "routines_status_next_due_check",
      sql`("status" = 'enabled' and "next_due_at" is not null) or ("status" in ('paused', 'completed') and "next_due_at" is null)`
    ),
    check(
      "routines_creator_non_empty_check",
      sql`length(trim("created_by_user_id")) > 0`
    ),
    check(
      "routines_updater_non_empty_check",
      sql`length(trim("updated_by_user_id")) > 0`
    ),
    check(
      "routines_updated_at_valid_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const routineRuns = sqliteTable(
  "routine_runs",
  {
    id: text("id").primaryKey(),
    routineId: text("routine_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scheduledFor: integer("scheduled_for").notNull(),
    status: text("status").notNull(),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    routineNameSnapshot: text("routine_name_snapshot"),
    destinationKindSnapshot: text("destination_kind_snapshot"),
    targetSpaceIdSnapshot: text("target_space_id_snapshot"),
    slackTeamIdSnapshot: text("slack_team_id_snapshot"),
    slackChannelIdSnapshot: text("slack_channel_id_snapshot"),
    slackThreadTsSnapshot: text("slack_thread_ts_snapshot"),
    slackConversationIdSnapshot: text("slack_conversation_id_snapshot"),
    slackThreadLabelSnapshot: text("slack_thread_label_snapshot"),
    executionEngine: text("execution_engine"),
    continuationDelegationId: text("continuation_delegation_id"),
    nativeDeliveryId: text("native_delivery_id"),
    publishedSignalId: text("published_signal_id"),
    failurePublicationAttemptCount: integer("failure_publication_attempt_count")
      .default(0)
      .notNull(),
    nextFailurePublicationAttemptAtMs: integer(
      "next_failure_publication_attempt_at_ms"
    ),
    startedAtMs: integer("started_at_ms"),
    finishedAtMs: integer("finished_at_ms"),
  },
  (table) => [
    uniqueIndex("routine_runs_routine_scheduled_unique").on(
      table.routineId,
      table.scheduledFor
    ),
    index("routine_runs_org_scheduled_idx").on(
      table.organizationId,
      desc(table.scheduledFor)
    ),
    index("routine_runs_routine_scheduled_idx").on(
      table.routineId,
      desc(table.scheduledFor)
    ),
    index("routine_runs_native_delivery_idx").on(table.nativeDeliveryId),
    index("routine_runs_status_started_idx").on(
      table.status,
      table.startedAtMs
    ),
    index("routine_runs_engine_status_started_idx").on(
      table.executionEngine,
      table.status,
      table.startedAtMs
    ),
    index("routine_runs_failure_publication_due_idx").on(
      table.status,
      table.publishedSignalId,
      table.nextFailurePublicationAttemptAtMs,
      table.finishedAtMs
    ),
    check("routine_runs_id_non_empty_check", sql`length(trim("id")) > 0`),
    check(
      "routine_runs_routine_non_empty_check",
      sql`length(trim("routine_id")) > 0`
    ),
    check(
      "routine_runs_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "routine_runs_status_check",
      sql`"status" in ('claimed', 'submitted', 'completed', 'failed', 'skipped')`
    ),
    check(
      "routine_runs_execution_engine_check",
      sql`"execution_engine" is null or "execution_engine" in ('legacy', 'workflow')`
    ),
    check(
      "routine_runs_finished_at_valid_check",
      sql`"finished_at_ms" is null or "started_at_ms" is null or "finished_at_ms" >= "started_at_ms"`
    ),
  ]
);
