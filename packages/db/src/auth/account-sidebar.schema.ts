import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "./auth.schema.ts";

export const accountSidebarPreferences = sqliteTable(
  "account_sidebar_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    preferences: text("preferences").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })]
);
