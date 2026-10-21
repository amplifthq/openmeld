import { sql } from "drizzle-orm";
import { bigint, check, text } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";

/**
 * Agent Direct Message Session state that is not Space content. Core's
 * dedicated Session operations are the only writer; the Session list joins
 * it. One row per Session Space; absent means active.
 */
export const directMessageSessionStates = applicationTable(
  "direct_message_session_states",
  {
    spaceId: text("space_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    archivedAtMs: bigint("archived_at_ms", { mode: "number" }),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  () => [
    check(
      "direct_message_session_states_archived_check",
      sql`"archived_at_ms" IS NULL OR "archived_at_ms" > 0`
    ),
  ]
);
