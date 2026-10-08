import { desc, sql } from "drizzle-orm";
import { bigint, check, index, text, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";
import { integerBoolean } from "../postgresql/schema-types.ts";

export const openMeldFeedbackReportingPolicies = applicationTable(
  "openMeldFeedback_reporting_policies",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reportingEnabled: integerBoolean("reporting_enabled")
      .default(sql`1`)
      .notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (_table) => [
    check(
      "openMeldFeedback_reporting_policies_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "openMeldFeedback_reporting_policies_enabled_boolean_check",
      sql`"reporting_enabled" in (0, 1)`
    ),
  ]
);

export const openMeldFeedbackInboxes = applicationTable(
  "openMeldFeedback_inboxes",
  {
    inboxId: text("inbox_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    label: text("label").notNull(),
    inboxKey: text("inbox_key").notNull(),
    deliveryMode: text("delivery_mode").notNull(),
    status: text("status").notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("openMeldFeedback_inboxes_inbox_key_unique").on(table.inboxKey),
  ]
);

export const openMeldFeedbackIssues = applicationTable(
  "openMeldFeedback_issues",
  {
    issueId: text("issue_id").primaryKey(),
    inboxId: text("inbox_id").notNull(),
    organizationId: text("organization_id").notNull(),
    category: text("category").notNull(),
    summary: text("summary").notNull(),
    details: text("details"),
    submitterKind: text("submitter_kind").notNull(),
    submitterUserId: text("submitter_user_id"),
    sourceOrganizationId: text("source_organization_id"),
    contactEmail: text("contact_email"),
    clientContext: text("client_context"),
    status: text("status").notNull().default("new"),
    triageNote: text("triage_note"),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_openMeldFeedback_issues_inbox_status_created").on(
      table.inboxId,
      table.status,
      desc(table.createdAtMs)
    ),
  ]
);
