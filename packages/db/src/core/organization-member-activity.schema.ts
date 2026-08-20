import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

export const organizationMemberActivity = sqliteTable(
  "organization_member_activity",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    humanProfileId: text("human_profile_id").notNull(),
    lastActiveAtMs: integer("last_active_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    check(
      "organization_member_activity_profile_id_check",
      sql`length(trim("human_profile_id")) > 0`
    ),
    check(
      "organization_member_activity_last_active_at_check",
      sql`"last_active_at_ms" >= 0`
    ),
    check(
      "organization_member_activity_updated_at_check",
      sql`"updated_at_ms" >= "last_active_at_ms"`
    ),
  ]
);
