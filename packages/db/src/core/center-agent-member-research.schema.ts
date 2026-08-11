import { asc, desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations } from "../auth/auth.schema.ts";

export const centerAgentMemberResearchBatches = sqliteTable(
  "center_agent_member_research_batches",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    status: text("status").default("queued").notNull(),
    requestedByUserId: text("requested_by_user_id").notNull(),
    requestedByMemberId: text("requested_by_member_id").notNull(),
    requestedByProfileId: text("requested_by_profile_id").notNull(),
    requestedByDisplayName: text("requested_by_display_name").notNull(),
    directMessageSpaceId: text("direct_message_space_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_member_research_one_active_batch_per_org")
      .on(table.organizationId)
      .where(sql`"status" in ('queued', 'running')`),
    index("center_agent_member_research_batches_org_created_idx").on(
      table.organizationId,
      desc(table.createdAtMs)
    ),
    index("center_agent_member_research_batches_status_updated_idx").on(
      table.status,
      asc(table.updatedAtMs)
    ),
    check(
      "center_agent_member_research_batches_scope_check",
      sql`"scope" in ('member', 'all')`
    ),
    check(
      "center_agent_member_research_batches_status_check",
      sql`"status" in ('queued', 'running', 'completed')`
    ),
    check(
      "center_agent_member_research_batches_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const centerAgentMemberResearchTasks = sqliteTable(
  "center_agent_member_research_tasks",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => centerAgentMemberResearchBatches.id, {
        onDelete: "cascade",
      }),
    subjectUserId: text("subject_user_id").notNull(),
    subjectDisplayName: text("subject_display_name").notNull(),
    position: integer("position").notNull(),
    status: text("status").default("queued").notNull(),
    failureCode: text("failure_code"),
    createdAtMs: integer("created_at_ms").notNull(),
    startedAtMs: integer("started_at_ms"),
    finishedAtMs: integer("finished_at_ms"),
  },
  (table) => [
    uniqueIndex("center_agent_member_research_tasks_batch_subject_unique").on(
      table.batchId,
      table.subjectUserId
    ),
    index("center_agent_member_research_tasks_batch_position_idx").on(
      table.batchId,
      table.position
    ),
    index("center_agent_member_research_tasks_status_started_idx").on(
      table.status,
      table.startedAtMs
    ),
    check(
      "center_agent_member_research_tasks_position_check",
      sql`"position" > 0`
    ),
    check(
      "center_agent_member_research_tasks_status_check",
      sql`"status" in ('queued', 'running', 'completed', 'failed')`
    ),
    check(
      "center_agent_member_research_tasks_timestamps_check",
      sql`("status" = 'queued' and "started_at_ms" is null and "finished_at_ms" is null) or ("status" = 'running' and "started_at_ms" is not null and "finished_at_ms" is null) or ("status" in ('completed', 'failed') and "started_at_ms" is not null and "finished_at_ms" is not null and "finished_at_ms" >= "started_at_ms")`
    ),
    check(
      "center_agent_member_research_tasks_failure_check",
      sql`("status" = 'failed' and "failure_code" is not null) or ("status" != 'failed' and "failure_code" is null)`
    ),
  ]
);
