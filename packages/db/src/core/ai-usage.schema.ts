import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { organizations } from "../auth/auth.schema.ts";

// No row (or a null limit) means unlimited. Keeping policy separate from usage
// lets later entitlements change the allowance without rewriting consumption.
export const organizationAiUsagePolicies = sqliteTable(
  "organization_ai_usage_policies",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dailyLimitNanoUsd: integer("daily_limit_nano_usd"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  }
);

// Core owns the durable consumption facts. Execution and billing policy have
// independent owners; neither is inferred from this ledger.
export const aiUsageRecords = sqliteTable(
  "ai_usage_records",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    runtime: text("runtime").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    purpose: text("purpose").notNull(),
    agentProfileId: text("agent_profile_id"),
    spaceId: text("space_id"),
    taskId: text("task_id"),
    attemptId: text("attempt_id"),
    computerId: text("computer_id"),
    controller: text("controller"),
    occurredAtMs: integer("occurred_at_ms").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costNanoUsd: integer("cost_nano_usd"),
    costKind: text("cost_kind"),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.runtime, table.eventId],
    }),
    index("ai_usage_records_org_time_idx").on(
      table.organizationId,
      table.occurredAtMs
    ),
    index("ai_usage_records_org_task_idx").on(
      table.organizationId,
      table.taskId,
      table.occurredAtMs
    ),
    index("ai_usage_records_org_computer_idx").on(
      table.organizationId,
      table.computerId,
      table.occurredAtMs
    ),
  ]
);
