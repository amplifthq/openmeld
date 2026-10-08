import { sql } from "drizzle-orm";
import { bigint, check, text } from "drizzle-orm/pg-core";
import { users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

export const userTimeContexts = applicationTable(
  "user_time_contexts",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    timeZone: text("time_zone").notNull(),
    source: text("source").$type<"web" | "desktop" | "service">().notNull(),
    observedAtMs: bigint("observed_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    check(
      "user_time_contexts_source_check",
      sql`${table.source} in ('web', 'desktop', 'service')`
    ),
    check(
      "user_time_contexts_time_zone_check",
      sql`length(trim(${table.timeZone})) between 1 and 128`
    ),
    check(
      "user_time_contexts_observed_at_check",
      sql`${table.observedAtMs} >= 0`
    ),
  ]
);
