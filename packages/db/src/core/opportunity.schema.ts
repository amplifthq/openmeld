import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

export const organizationOpportunities = sqliteTable(
  "organization_opportunities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    opportunityKey: text("opportunity_key").notNull(),
    title: text("title").notNull(),
    observation: text("observation").notNull(),
    expectedBenefit: text("expected_benefit").notNull(),
    suggestedNextStep: text("suggested_next_step").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    status: text("status").default("open").notNull(),
    createdByProfileId: text("created_by_profile_id").notNull(),
    sourceNativeDeliveryId: text("source_native_delivery_id"),
    decidedByUserId: text("decided_by_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    createdAtMs: integer("created_at_ms").notNull(),
    decidedAtMs: integer("decided_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("organization_opportunities_recipient_key_unique").on(
      table.organizationId,
      table.recipientUserId,
      table.opportunityKey
    ),
    index("organization_opportunities_recipient_status_updated_idx").on(
      table.organizationId,
      table.recipientUserId,
      table.status,
      desc(table.updatedAtMs)
    ),
    check(
      "organization_opportunities_identity_non_empty_check",
      sql`length(trim("id")) > 0 and length(trim("organization_id")) > 0 and length(trim("recipient_user_id")) > 0 and length(trim("opportunity_key")) between 1 and 256 and length(trim("created_by_profile_id")) > 0 and ("source_native_delivery_id" is null or length(trim("source_native_delivery_id")) > 0)`
    ),
    check(
      "organization_opportunities_content_length_check",
      sql`length(trim("title")) between 1 and 160 and length(trim("observation")) between 1 and 1000 and length(trim("expected_benefit")) between 1 and 500 and length(trim("suggested_next_step")) between 1 and 500`
    ),
    check(
      "organization_opportunities_evidence_check",
      sql`length("evidence_json") between 3 and 8192 and json_valid("evidence_json") and json_type("evidence_json") = 'array' and json_array_length("evidence_json") between 1 and 8`
    ),
    check(
      "organization_opportunities_status_check",
      sql`("status" = 'open' and "decided_by_user_id" is null and "decided_at_ms" is null) or ("status" in ('accepted', 'deferred', 'dismissed') and "decided_by_user_id" is not null and "decided_at_ms" is not null)`
    ),
    check(
      "organization_opportunities_timestamps_check",
      sql`"created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("decided_at_ms" is null or "decided_at_ms" >= "created_at_ms")`
    ),
  ]
);
