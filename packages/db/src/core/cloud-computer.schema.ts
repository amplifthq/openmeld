import { bigint, text, uniqueIndex } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";

/** One personal Computer per account, across organizations and Agents. */
export const cloudComputers = applicationTable(
  "cloud_computers",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    provider: text("provider").notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("cloud_computers_owner_unique").on(table.ownerUserId)]
);
