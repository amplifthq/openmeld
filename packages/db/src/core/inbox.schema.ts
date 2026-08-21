import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

export const inboxItems = sqliteTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    attention: text("attention").notNull(),
    importance: text("importance").notNull(),
    title: text("title").notNull(),
    preview: text("preview").notNull(),
    contextLabel: text("context_label"),
    sourceKind: text("source_kind").notNull(),
    sourceKey: text("source_key").notNull(),
    sourceTargetJson: text("source_target_json").notNull(),
    resolutionStatus: text("resolution_status").notNull(),
    readAtMs: integer("read_at_ms"),
    clearedAtMs: integer("cleared_at_ms"),
    resolvedAtMs: integer("resolved_at_ms"),
    occurredAtMs: integer("occurred_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("inbox_items_recipient_source_unique").on(
      table.organizationId,
      table.recipientUserId,
      table.sourceKind,
      table.sourceKey
    ),
    index("inbox_items_recipient_list_idx").on(
      table.organizationId,
      table.recipientUserId,
      table.clearedAtMs,
      table.occurredAtMs,
      table.id
    ),
    index("inbox_items_recipient_unread_idx").on(
      table.organizationId,
      table.recipientUserId,
      table.readAtMs,
      table.clearedAtMs,
      table.occurredAtMs
    ),
    index("inbox_items_recipient_action_idx").on(
      table.organizationId,
      table.recipientUserId,
      table.attention,
      table.resolutionStatus,
      table.clearedAtMs
    ),
    index("inbox_items_source_resolution_idx").on(
      table.organizationId,
      table.sourceKind,
      table.sourceKey,
      table.resolutionStatus
    ),
    check("inbox_items_id_non_empty_check", sql`length(trim("id")) > 0`),
    check(
      "inbox_items_identity_non_empty_check",
      sql`length(trim("organization_id")) > 0 and length(trim("recipient_user_id")) > 0 and length(trim("source_key")) > 0`
    ),
    check(
      "inbox_items_kind_check",
      sql`"kind" in ('space_message', 'space_reference', 'agent_reply', 'agent_interaction', 'wake_outcome', 'center_agent_update', 'center_agent_task', 'document_review', 'organization_request', 'system_issue')`
    ),
    check(
      "inbox_items_attention_check",
      sql`"attention" in ('update', 'action_required')`
    ),
    check(
      "inbox_items_importance_check",
      sql`"importance" in ('normal', 'urgent')`
    ),
    check(
      "inbox_items_source_kind_check",
      sql`"source_kind" in ('space_signal', 'runtime_coordinator_interaction', 'remote_agent_native_delivery', 'remote_agent_native_interaction', 'center_agent_task_event', 'organization_document_draft', 'organization_opportunity', 'organization_member_request', 'system_attention_event')`
    ),
    check(
      "inbox_items_resolution_check",
      sql`("attention" = 'update' and "resolution_status" = 'not_applicable' and "resolved_at_ms" is null) or ("attention" = 'action_required' and "resolution_status" = 'open' and "resolved_at_ms" is null) or ("attention" = 'action_required' and "resolution_status" = 'resolved' and "resolved_at_ms" is not null)`
    ),
    check(
      "inbox_items_title_length_check",
      sql`length(trim("title")) between 1 and 160`
    ),
    check(
      "inbox_items_preview_length_check",
      sql`length(trim("preview")) between 1 and 500`
    ),
    check(
      "inbox_items_context_label_length_check",
      sql`"context_label" is null or length(trim("context_label")) between 1 and 160`
    ),
    check(
      "inbox_items_source_target_json_check",
      sql`length("source_target_json") between 2 and 2048 and json_valid("source_target_json") and json_type("source_target_json") = 'object'`
    ),
    check(
      "inbox_items_timestamps_check",
      sql`"occurred_at_ms" >= 0 and "created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("read_at_ms" is null or "read_at_ms" >= 0) and ("cleared_at_ms" is null or "cleared_at_ms" >= 0) and ("resolved_at_ms" is null or "resolved_at_ms" >= 0)`
    ),
  ]
);

export const inboxNotificationPreferences = sqliteTable(
  "inbox_notification_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    urgentEmailEnabled: integer("urgent_email_enabled", { mode: "boolean" })
      .default(true)
      .notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (_table) => [
    check(
      "inbox_notification_preferences_user_non_empty_check",
      sql`length(trim("user_id")) > 0`
    ),
    check(
      "inbox_notification_preferences_enabled_check",
      sql`"urgent_email_enabled" in (0, 1)`
    ),
    check(
      "inbox_notification_preferences_timestamps_check",
      sql`"created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const inboxCenterAgentReadWatermarks = sqliteTable(
  "inbox_center_agent_read_watermarks",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    throughOccurredAtMs: integer("through_occurred_at_ms").notNull(),
    readAtMs: integer("read_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("inbox_center_agent_read_watermarks_scope_unique").on(
      table.organizationId,
      table.recipientUserId,
      table.spaceId
    ),
    check(
      "inbox_center_agent_read_watermarks_identity_non_empty_check",
      sql`length(trim("organization_id")) > 0 and length(trim("recipient_user_id")) > 0 and length(trim("space_id")) > 0`
    ),
    check(
      "inbox_center_agent_read_watermarks_timestamps_check",
      sql`"through_occurred_at_ms" >= 0 and "read_at_ms" >= 0 and "created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const inboxEmailDeliveries = sqliteTable(
  "inbox_email_deliveries",
  {
    id: text("id").primaryKey(),
    inboxItemId: text("inbox_item_id")
      .notNull()
      .references(() => inboxItems.id, { onDelete: "cascade" }),
    state: text("state").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAtMs: integer("next_attempt_at_ms").notNull(),
    claimId: text("claim_id"),
    claimExpiresAtMs: integer("claim_expires_at_ms"),
    messageId: text("message_id"),
    lastErrorCode: text("last_error_code"),
    lastErrorRetryable: integer("last_error_retryable", { mode: "boolean" }),
    suppressedReason: text("suppressed_reason"),
    sentAtMs: integer("sent_at_ms"),
    failedAtMs: integer("failed_at_ms"),
    suppressedAtMs: integer("suppressed_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("inbox_email_deliveries_item_unique").on(table.inboxItemId),
    index("inbox_email_deliveries_due_idx").on(
      table.state,
      table.nextAttemptAtMs,
      table.claimExpiresAtMs
    ),
    check(
      "inbox_email_deliveries_identity_non_empty_check",
      sql`length(trim("id")) > 0 and length(trim("inbox_item_id")) > 0`
    ),
    check(
      "inbox_email_deliveries_state_check",
      sql`"state" in ('pending', 'sending', 'sent', 'failed', 'suppressed')`
    ),
    check(
      "inbox_email_deliveries_attempt_check",
      sql`"attempt_count" >= 0 and "next_attempt_at_ms" >= 0`
    ),
    check(
      "inbox_email_deliveries_claim_check",
      sql`("claim_id" is null and "claim_expires_at_ms" is null) or (length(trim("claim_id")) > 0 and "claim_expires_at_ms" is not null)`
    ),
    check(
      "inbox_email_deliveries_terminal_check",
      sql`("state" = 'sent' and "sent_at_ms" is not null and "message_id" is not null) or ("state" = 'failed' and "failed_at_ms" is not null and "last_error_code" is not null) or ("state" = 'suppressed' and "suppressed_at_ms" is not null and "suppressed_reason" is not null) or ("state" in ('pending', 'sending') and "sent_at_ms" is null and "failed_at_ms" is null and "suppressed_at_ms" is null)`
    ),
    check(
      "inbox_email_deliveries_timestamps_check",
      sql`"created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);
