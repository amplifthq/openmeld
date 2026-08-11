import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { organizations } from "../auth/auth.schema.ts";

// Core owns this rebuildable, Organization-scoped weekly read projection.
// RuntimeCoordinator and Space ledgers remain the source facts.
export const evalReports = sqliteTable(
  "eval_reports",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodStartMs: integer("period_start").notNull(),
    periodEndMs: integer("period_end").notNull(),
    metricsJson: text("metrics_json").notNull(),
    createdAtMs: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.periodStartMs, table.periodEndMs],
    }),
    index("eval_reports_organization_period_end_idx").on(
      table.organizationId,
      table.periodEndMs
    ),
    check(
      "eval_reports_period_order_check",
      sql`${table.periodEndMs} > ${table.periodStartMs}`
    ),
  ]
);
