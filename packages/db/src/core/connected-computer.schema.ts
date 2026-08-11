import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const openMeldDaemonConnectedComputers = sqliteTable(
  "openMeldDaemon_connected_computers",
  {
    ownerUserId: text("owner_user_id").notNull(),
    connectedComputerId: text("connected_computer_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("openMeldDaemon_connected_computers_owner_computer_unique").on(
      table.ownerUserId,
      table.connectedComputerId
    ),
  ]
);
