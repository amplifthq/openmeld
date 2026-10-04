import { bigint, text, uniqueIndex } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";

export const openMeldDaemonConnectedComputers = applicationTable(
  "openMeldDaemon_connected_computers",
  {
    ownerUserId: text("owner_user_id").notNull(),
    connectedComputerId: text("connected_computer_id").notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("openMeldDaemon_connected_computers_owner_computer_unique").on(
      table.ownerUserId,
      table.connectedComputerId
    ),
  ]
);
