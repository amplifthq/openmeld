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

export const organizationBindingAuthorizationPreferences = sqliteTable(
  "organization_binding_authorization_preferences",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    autoAuthorizeAgentProfileBindings: integer(
      "auto_authorize_agent_profile_bindings",
      { mode: "boolean" }
    )
      .default(false)
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("organization_binding_auth_prefs_org_user_uq_idx").on(
      table.organizationId,
      table.userId
    ),
    index("organization_binding_auth_prefs_user_idx").on(table.userId),
    check(
      "organization_binding_auth_prefs_id_non_empty_check",
      sql`length(trim("id")) > 0`
    ),
    check(
      "organization_binding_auth_prefs_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "organization_binding_auth_prefs_user_non_empty_check",
      sql`length(trim("user_id")) > 0`
    ),
    check(
      "organization_binding_auth_prefs_bool_check",
      sql`"auto_authorize_agent_profile_bindings" in (0, 1)`
    ),
  ]
);
