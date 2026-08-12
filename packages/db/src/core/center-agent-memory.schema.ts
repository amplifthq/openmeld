import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { members, organizations, users } from "../auth/auth.schema.ts";

export const centerAgentMemoryPolicies = sqliteTable(
  "center_agent_memory_policies",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizationMemoryOptIn: integer("organization_memory_opt_in", {
      mode: "boolean",
    })
      .default(true)
      .notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (_table) => [
    check(
      "center_agent_memory_policies_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "center_agent_memory_policies_opt_in_boolean_check",
      sql`"organization_memory_opt_in" in (0, 1)`
    ),
  ]
);

export const centerAgentMemorySubjects = sqliteTable(
  "center_agent_memory_subjects",
  {
    subjectId: text("subject_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subjectKind: text("subject_kind").notNull(),
    memberId: text("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    memberUserId: text("member_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").default("zep_cloud").notNull(),
    zepUserId: text("zep_user_id"),
    zepGraphId: text("zep_graph_id"),
    status: text("status").default("active").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    deletedAtMs: integer("deleted_at_ms"),
    lastError: text("last_error"),
  },
  (table) => [
    index("center_agent_memory_subjects_org_kind_idx").on(
      table.organizationId,
      table.subjectKind
    ),
    index("center_agent_memory_subjects_member_user_idx").on(
      table.organizationId,
      table.memberUserId
    ),
    uniqueIndex("center_agent_memory_subjects_zep_user_uq_idx").on(
      table.zepUserId
    ),
    uniqueIndex("center_agent_memory_subjects_zep_graph_uq_idx").on(
      table.zepGraphId
    ),
    check(
      "center_agent_memory_subjects_id_non_empty_check",
      sql`length(trim("subject_id")) > 0`
    ),
    check(
      "center_agent_memory_subjects_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "center_agent_memory_subjects_kind_check",
      sql`"subject_kind" in ('member', 'organization')`
    ),
    check(
      "center_agent_memory_subjects_provider_check",
      sql`"provider" = 'zep_cloud'`
    ),
    check(
      "center_agent_memory_subjects_status_check",
      sql`"status" in ('active', 'deleting', 'deleted', 'delete_failed')`
    ),
    check(
      "center_agent_memory_subjects_member_shape_check",
      sql`
        ("subject_kind" != 'member')
        or (
          "member_user_id" is not null
          and "zep_user_id" is not null
          and "zep_graph_id" is null
        )
      `
    ),
    check(
      "center_agent_memory_subjects_org_shape_check",
      sql`
        ("subject_kind" != 'organization')
        or (
          "member_id" is null
          and "member_user_id" is null
          and "zep_user_id" is null
          and "zep_graph_id" is not null
        )
      `
    ),
  ]
);
