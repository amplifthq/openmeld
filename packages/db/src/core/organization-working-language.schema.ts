import { WORKING_LANGUAGE_TAG_MAX_CHARS } from "@openmeld/schemas";
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

export const organizationWorkingLanguagePreferences = sqliteTable(
  "organization_working_language_preferences",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    languageTag: text("language_tag").notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  () => [
    check(
      "organization_working_language_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "organization_working_language_mode_check",
      sql`"mode" in ('automatic', 'selected')`
    ),
    check(
      "organization_working_language_tag_length_check",
      sql.raw(
        `length(trim("language_tag")) between 2 and ${WORKING_LANGUAGE_TAG_MAX_CHARS}`
      )
    ),
    check("organization_working_language_revision_check", sql`"revision" > 0`),
    check(
      "organization_working_language_attribution_check",
      sql`("mode" = 'automatic' and "updated_by_user_id" is null) or ("mode" = 'selected' and "updated_by_user_id" is not null)`
    ),
    check(
      "organization_working_language_timestamps_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);
