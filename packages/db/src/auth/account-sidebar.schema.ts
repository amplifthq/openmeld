import { bigint, primaryKey, text } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";
import { organizations, users } from "./auth.schema.ts";

export const accountSidebarPreferences = applicationTable(
  "account_sidebar_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    revision: bigint("revision", { mode: "number" }).notNull(),
    preferences: text("preferences").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })]
);
