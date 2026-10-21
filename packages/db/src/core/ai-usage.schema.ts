import { sql } from "drizzle-orm";
import { bigint, check, index, primaryKey, text } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

// Deleting a workspace does not give its creator another sponsored allowance.
export const aiFreeGrants = applicationTable("ai_free_grants", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .unique()
    .references(() => organizations.id, { onDelete: "set null" }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
});

// Presence of a BYOK row is the single source of truth for selecting BYOK.
// Free and Internal credentials are separate so switching never resets spend
// or depends on propagation of a changed upstream key limit.
export const organizationAiCredentials = applicationTable(
  "organization_ai_credentials",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    providerKeyHash: text("provider_key_hash"),
    keySuffix: text("key_suffix").notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.source] })]
);

// Historical daily policies remain for data retention; native monthly provider
// budgets now own admission. Do not write new entitlements to this table.
export const organizationAiUsagePolicies = applicationTable(
  "organization_ai_usage_policies",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dailyLimitNanoUsd: bigint("daily_limit_nano_usd", { mode: "number" }),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  }
);

// Core owns the durable consumption facts. Execution and billing policy have
// independent owners; neither is inferred from this ledger.
export const aiUsageRecords = applicationTable(
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
    occurredAtMs: bigint("occurred_at_ms", { mode: "number" }).notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    totalTokens: bigint("total_tokens", { mode: "number" }),
    costNanoUsd: bigint("cost_nano_usd", { mode: "number" }),
    costKind: text("cost_kind"),
    // Admission projections of the immutable record. Rows recorded before
    // credit reservations have no funding_source column value.
    fundingSource: text("funding_source"),
    // Platform-funded admission holds an upper estimate until the provider
    // reports a cost. Admission time assigns the credit period; the hold
    // expiry policy is applied when reading. See ai-billing.md.
    creditHoldNanoUsd: bigint("credit_hold_nano_usd", { mode: "number" }),
    creditHoldAdmittedAtMs: bigint("credit_hold_admitted_at_ms", {
      mode: "number",
    }),
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
    check(
      "ai_usage_records_credit_hold_check",
      sql`("credit_hold_nano_usd" is null and "credit_hold_admitted_at_ms" is null)
        or ("credit_hold_nano_usd" > 0 and "credit_hold_admitted_at_ms" is not null)`
    ),
  ]
);
