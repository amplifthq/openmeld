import { sql } from "drizzle-orm";
import { bigint, check, index, primaryKey, text } from "drizzle-orm/pg-core";
import { organizations } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

// Core owns this rebuildable, Organization-scoped weekly read projection.
// RuntimeCoordinator and Space ledgers remain the source facts.
export const evalReports = applicationTable(
  "eval_reports",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodStartMs: bigint("period_start", { mode: "number" }).notNull(),
    periodEndMs: bigint("period_end", { mode: "number" }).notNull(),
    metricsJson: text("metrics_json").notNull(),
    createdAtMs: bigint("created_at", { mode: "number" }).notNull(),
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
