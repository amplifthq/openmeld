import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

export const organizationMemberPresenceSessions = sqliteTable(
  "organization_member_presence_sessions",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    humanProfileId: text("human_profile_id").notNull(),
    sequence: integer("sequence").notNull(),
    lastInteractionAtMs: integer("last_interaction_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.userId, table.sessionId],
    }),
    index("organization_member_presence_expiry_idx").on(
      table.organizationId,
      table.expiresAtMs
    ),
    check("organization_member_presence_sequence_check", sql`"sequence" > 0`),
  ]
);

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
