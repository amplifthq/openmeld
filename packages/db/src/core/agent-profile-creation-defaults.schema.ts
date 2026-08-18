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
import { projects } from "./project.schema.ts";

export const agentProfileCreationDefaults = sqliteTable(
  "agent_profile_creation_defaults",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentControllerRef: text("agent_controller_ref").notNull(),
    defaultProjectId: text("default_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    modelId: text("model_id"),
    reasoningLevel: text("reasoning_level"),
    agentControllerPermissionMode: text("agent_controller_permission_mode"),
    openCodePermissionJson: text("open_code_permission_json"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_profile_creation_defaults_scope_uq_idx").on(
      table.organizationId,
      table.userId,
      table.agentControllerRef
    ),
    index("agent_profile_creation_defaults_user_idx").on(table.userId),
    check(
      "agent_profile_creation_defaults_id_non_empty_check",
      sql`length(trim("id")) > 0`
    ),
    check(
      "agent_profile_creation_defaults_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "agent_profile_creation_defaults_user_non_empty_check",
      sql`length(trim("user_id")) > 0`
    ),
    check(
      "agent_profile_creation_defaults_controller_non_empty_check",
      sql`length(trim("agent_controller_ref")) > 0`
    ),
    check(
      "agent_profile_creation_defaults_reasoning_model_check",
      sql`"reasoning_level" is null or "model_id" is not null`
    ),
    check(
      "agent_profile_creation_defaults_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);
