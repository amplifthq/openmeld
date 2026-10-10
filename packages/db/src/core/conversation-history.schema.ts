import { sql } from "drizzle-orm";
import { bigint, check, primaryKey, text } from "drizzle-orm/pg-core";
import { users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

/** Personal read boundary. Shared conversation content remains owned by Space. */
export const conversationHistoryDeletions = applicationTable(
  "conversation_history_deletions",
  {
    spaceId: text("space_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    throughPosition: bigint("through_position", { mode: "number" }).notNull(),
    deletedAtMs: bigint("deleted_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.userId] }),
    check(
      "conversation_history_deletions_boundary_check",
      sql`"through_position" >= 0 AND "deleted_at_ms" > 0`
    ),
  ]
);
