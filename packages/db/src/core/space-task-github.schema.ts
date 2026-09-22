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

export const spaceTaskGitHubIssueLinks = sqliteTable(
  "space_task_github_issue_links",
  {
    spaceId: text("space_id").notNull(),
    taskId: text("task_id").notNull(),
    provider: text("provider").notNull(),
    ownerLogin: text("owner_login").notNull(),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    attachedAtMs: integer("attached_at_ms").notNull(),
    detachedAtMs: integer("detached_at_ms"),
    lastObservedState: text("last_observed_state"),
    lastObservedAtMs: integer("last_observed_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.spaceId,
        table.taskId,
        table.provider,
        table.ownerLogin,
        table.repo,
        table.number,
      ],
    }),
    index("space_task_github_issue_links_identity_idx").on(
      table.provider,
      table.ownerLogin,
      table.repo,
      table.number,
      table.detachedAtMs
    ),
    check(
      "space_task_github_issue_links_provider_check",
      sql`"provider" = 'github'`
    ),
    check(
      "space_task_github_issue_links_ids_check",
      sql`length(trim("space_id")) > 0 and "task_id" glob 'tsk_*' and length(trim("owner_login")) > 0 and length(trim("repo")) > 0 and "number" > 0`
    ),
    check(
      "space_task_github_issue_links_url_check",
      sql`length(trim("url")) > 0`
    ),
    check(
      "space_task_github_issue_links_state_check",
      sql`"last_observed_state" is null or "last_observed_state" in ('open', 'closed')`
    ),
    check(
      "space_task_github_issue_links_time_check",
      sql`"attached_at_ms" >= 0 and "updated_at_ms" >= "attached_at_ms" and ("detached_at_ms" is null or "detached_at_ms" >= "attached_at_ms") and ("last_observed_at_ms" is null or "last_observed_at_ms" >= 0)`
    ),
  ]
);

export const githubAppWebhookDeliveries = sqliteTable(
  "github_app_webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    event: text("event").notNull(),
    action: text("action"),
    ownerLogin: text("owner_login"),
    repo: text("repo"),
    number: integer("number"),
    issueState: text("issue_state"),
    gatewayRequestId: text("gateway_request_id").notNull(),
    state: text("state").notNull(),
    claimId: text("claim_id"),
    claimExpiresAtMs: integer("claim_expires_at_ms"),
    firstReceivedAtMs: integer("first_received_at_ms").notNull(),
    lastReceivedAtMs: integer("last_received_at_ms").notNull(),
    completedAtMs: integer("completed_at_ms"),
    failureCode: text("failure_code"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("github_app_webhook_deliveries_state_idx").on(
      table.state,
      table.updatedAtMs
    ),
    check(
      "github_app_webhook_deliveries_id_check",
      sql`length(trim("delivery_id")) > 0`
    ),
    check(
      "github_app_webhook_deliveries_state_check",
      sql`"state" in ('queued', 'processing', 'completed', 'failed', 'ignored')`
    ),
    check(
      "github_app_webhook_deliveries_issue_state_check",
      sql`"issue_state" is null or "issue_state" in ('open', 'closed')`
    ),
    check(
      "github_app_webhook_deliveries_time_check",
      sql`"first_received_at_ms" >= 0 and "last_received_at_ms" >= "first_received_at_ms" and "updated_at_ms" >= 0 and ("completed_at_ms" is null or "completed_at_ms" >= "first_received_at_ms")`
    ),
  ]
);
