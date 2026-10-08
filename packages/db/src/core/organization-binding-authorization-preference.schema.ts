import { sql } from "drizzle-orm";
import { check, index, text, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import {
  applicationTable,
  currentTimestampMilliseconds,
} from "../postgresql/schema.ts";
import {
  epochMilliseconds,
  integerBoolean,
} from "../postgresql/schema-types.ts";

export const organizationBindingAuthorizationPreferences = applicationTable(
  "organization_binding_authorization_preferences",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    autoAuthorizeAgentProfileBindings: integerBoolean(
      "auto_authorize_agent_profile_bindings"
    )
      .default(sql`0`)
      .notNull(),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    updatedAt: epochMilliseconds("updated_at")
      .default(currentTimestampMilliseconds)
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
