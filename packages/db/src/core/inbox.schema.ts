import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";
import { integerBoolean } from "../postgresql/schema-types.ts";

/** Monotonic native installation facts, not another notification/read ledger. */
export const desktopUpdateInstallations = applicationTable(
  "desktop_update_installations",
  {
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    lane: text("lane").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    observationJson: text("observation_json").notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.ownerUserId, table.installationId, table.lane],
    }),
    check(
      "desktop_update_installations_sequence_check",
      sql`"sequence" > 0 and "updated_at_ms" >= 0`
    ),
    check(
      "desktop_update_installations_json_check",
      sql`"observation_json" is json object`
    ),
    check(
      "desktop_update_installations_lane_check",
      sql`"lane" in ('prod', 'dev-local', 'canary')`
    ),
  ]
);

/** Short-lived query cutoffs, never copies of conversation or Inbox content. */
export const inboxFeedSnapshots = applicationTable(
  "inbox_feed_snapshots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    unreadOnly: integerBoolean("unread_only").notNull(),
    agentsOnly: integerBoolean("agents_only").notNull(),
    peopleOnly: integerBoolean("people_only").notNull().default(sql`0`),
    conversationType: text("conversation_type").notNull().default("all"),
    throughRowId: bigint("through_row_id", { mode: "number" }).notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    index("inbox_feed_snapshot_expiry_idx").on(table.expiresAtMs),
    index("inbox_feed_snapshot_recipient_idx").on(
      table.recipientUserId,
      table.organizationId,
      table.expiresAtMs
    ),
    check(
      "inbox_feed_snapshot_category_check",
      sql`"category" in ('all', 'mentions', 'needs_action', 'needs_review')`
    ),
    check(
      "inbox_feed_snapshot_cutoff_check",
      sql`"through_row_id" >= 0 and "created_at_ms" >= 0 and "expires_at_ms" > "created_at_ms"`
    ),
  ]
);

export const inboxItems = applicationTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
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
    sourceFactsJson: text("source_facts_json"),
    resolutionStatus: text("resolution_status").notNull(),
    readAtMs: bigint("read_at_ms", { mode: "number" }),
    clearedAtMs: bigint("cleared_at_ms", { mode: "number" }),
    resolvedAtMs: bigint("resolved_at_ms", { mode: "number" }),
    occurredAtMs: bigint("occurred_at_ms", { mode: "number" }).notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_items_sequence_unique").on(table.sequence),
    // PostgreSQL requires the insertion-order key explicitly in this index.
    index("inbox_items_observation_idx").on(
      table.recipientUserId,
      table.organizationId,
      table.sequence
    ),
    uniqueIndex("inbox_items_account_source_unique")
      .on(table.recipientUserId, table.sourceKind, table.sourceKey)
      .where(sql`"organization_id" is null`),
    check(
      "inbox_items_account_scope_check",
      sql`("organization_id" is not null and "source_kind" not in ('computer_connection', 'desktop_update')) or ("organization_id" is null and "source_kind" in ('computer_connection', 'desktop_update') and "kind" = "source_kind" and (("source_target_json")::jsonb #>> '{kind}') = "source_kind")`
    ),
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
      sql`"kind" in ('space_joined', 'space_message', 'space_reference', 'space_mention', 'agent_reply', 'agent_interaction', 'wake_outcome', 'center_agent_update', 'center_agent_task', 'document_review', 'organization_request', 'agent_access_request', 'agent_space_request', 'credential_confirmation', 'system_issue', 'computer_connection', 'desktop_update')`
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
      sql`"source_kind" in ('space_signal', 'runtime_coordinator_interaction', 'remote_agent_native_delivery', 'remote_agent_native_interaction', 'center_agent_task_event', 'organization_document_draft', 'organization_opportunity', 'organization_member_request', 'agent_profile_work_recovery', 'agent_access_request', 'credential_confirmation', 'system_attention_event', 'computer_connection', 'desktop_update')`
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
      sql`length("source_target_json") between 2 and 2048 and "source_target_json" is json object`
    ),
    check(
      "inbox_items_timestamps_check",
      sql`"occurred_at_ms" >= 0 and "created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("read_at_ms" is null or "read_at_ms" >= 0) and ("cleared_at_ms" is null or "cleared_at_ms" >= 0) and ("resolved_at_ms" is null or "resolved_at_ms" >= 0)`
    ),
  ]
);

/** Membership only: contents and read state stay in the canonical Inbox item. */
export const inboxFeedSnapshotMembers = applicationTable(
  "inbox_feed_snapshot_members",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => inboxFeedSnapshots.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => inboxItems.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.itemId] }),
    index("inbox_feed_snapshot_members_item_idx").on(table.itemId),
  ]
);

export const inboxNotificationPreferences = applicationTable(
  "inbox_notification_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    urgentEmailEnabled: integerBoolean("urgent_email_enabled")
      .default(sql`1`)
      .notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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

export const inboxMessageNotificationDefaults = applicationTable(
  "inbox_message_notification_defaults",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
  },
  (table) => [
    check(
      "inbox_message_notification_defaults_mode_check",
      sql`${table.mode} in ('all_messages', 'mentions_and_replies')`
    ),
  ]
);

export const inboxConversationNotificationPreferences = applicationTable(
  "inbox_conversation_notification_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    mode: text("mode").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.organizationId, table.spaceId],
    }),
    check(
      "inbox_conversation_notification_preferences_mode_check",
      sql`${table.mode} in ('all_messages', 'mentions_and_replies', 'muted')`
    ),
    check(
      "inbox_conversation_notification_preferences_space_check",
      sql`length(trim(${table.spaceId})) > 0`
    ),
  ]
);

export const inboxCenterAgentReadWatermarks = applicationTable(
  "inbox_center_agent_read_watermarks",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    throughOccurredAtMs: bigint("through_occurred_at_ms", {
      mode: "number",
    }).notNull(),
    readAtMs: bigint("read_at_ms", { mode: "number" }).notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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

export const inboxSpaceThreadReadWatermarks = applicationTable(
  "inbox_space_thread_read_watermarks",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    threadRootSignalId: text("thread_root_signal_id").notNull(),
    throughOccurredAtMs: bigint("through_occurred_at_ms", {
      mode: "number",
    }).notNull(),
    readAtMs: bigint("read_at_ms", { mode: "number" }).notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_space_thread_read_watermarks_scope_unique").on(
      table.organizationId,
      table.recipientUserId,
      table.spaceId,
      table.threadRootSignalId
    ),
    check(
      "inbox_space_thread_read_watermarks_identity_non_empty_check",
      sql`length(trim("organization_id")) > 0 and length(trim("recipient_user_id")) > 0 and length(trim("space_id")) > 0 and length(trim("thread_root_signal_id")) > 0`
    ),
    check(
      "inbox_space_thread_read_watermarks_timestamps_check",
      sql`"through_occurred_at_ms" >= 0 and "read_at_ms" >= 0 and "created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const inboxEmailDeliveries = applicationTable(
  "inbox_email_deliveries",
  {
    id: text("id").primaryKey(),
    inboxItemId: text("inbox_item_id")
      .notNull()
      .references(() => inboxItems.id, { onDelete: "cascade" }),
    state: text("state").default("pending").notNull(),
    attemptCount: bigint("attempt_count", { mode: "number" })
      .default(0)
      .notNull(),
    nextAttemptAtMs: bigint("next_attempt_at_ms", { mode: "number" }).notNull(),
    claimId: text("claim_id"),
    claimExpiresAtMs: bigint("claim_expires_at_ms", { mode: "number" }),
    messageId: text("message_id"),
    lastErrorCode: text("last_error_code"),
    lastErrorRetryable: integerBoolean("last_error_retryable"),
    suppressedReason: text("suppressed_reason"),
    sentAtMs: bigint("sent_at_ms", { mode: "number" }),
    failedAtMs: bigint("failed_at_ms", { mode: "number" }),
    suppressedAtMs: bigint("suppressed_at_ms", { mode: "number" }),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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
