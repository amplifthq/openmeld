import { sql } from "drizzle-orm";
import { bigint, check, index, primaryKey, text } from "drizzle-orm/pg-core";
import { organizations } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

export const spaceTaskGitHubIssueLinks = applicationTable(
  "space_task_github_issue_links",
  {
    spaceId: text("space_id").notNull(),
    taskId: text("task_id").notNull(),
    provider: text("provider").notNull(),
    ownerLogin: text("owner_login").notNull(),
    repo: text("repo").notNull(),
    number: bigint("number", { mode: "number" }).notNull(),
    url: text("url").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    attachedAtMs: bigint("attached_at_ms", { mode: "number" }).notNull(),
    detachedAtMs: bigint("detached_at_ms", { mode: "number" }),
    lastObservedState: text("last_observed_state"),
    lastObservedAtMs: bigint("last_observed_at_ms", { mode: "number" }),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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
      sql`length(trim("space_id")) > 0 and "task_id" ~ '^tsk_.*$' and length(trim("owner_login")) > 0 and length(trim("repo")) > 0 and "number" > 0`
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

export const githubAppWebhookDeliveries = applicationTable(
  "github_app_webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    event: text("event").notNull(),
    action: text("action"),
    ownerLogin: text("owner_login"),
    repo: text("repo"),
    number: bigint("number", { mode: "number" }),
    issueState: text("issue_state"),
    gatewayRequestId: text("gateway_request_id").notNull(),
    state: text("state").notNull(),
    claimId: text("claim_id"),
    claimExpiresAtMs: bigint("claim_expires_at_ms", { mode: "number" }),
    firstReceivedAtMs: bigint("first_received_at_ms", {
      mode: "number",
    }).notNull(),
    lastReceivedAtMs: bigint("last_received_at_ms", {
      mode: "number",
    }).notNull(),
    completedAtMs: bigint("completed_at_ms", { mode: "number" }),
    failureCode: text("failure_code"),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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
