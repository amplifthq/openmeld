CREATE TABLE `inbox_email_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_item_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at_ms` integer NOT NULL,
	`claim_id` text,
	`claim_expires_at_ms` integer,
	`message_id` text,
	`last_error_code` text,
	`last_error_retryable` integer,
	`suppressed_reason` text,
	`sent_at_ms` integer,
	`failed_at_ms` integer,
	`suppressed_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inbox_email_deliveries_identity_non_empty_check" CHECK(length(trim("id")) > 0 and length(trim("inbox_item_id")) > 0),
	CONSTRAINT "inbox_email_deliveries_state_check" CHECK("state" in ('pending', 'sending', 'sent', 'failed', 'suppressed')),
	CONSTRAINT "inbox_email_deliveries_attempt_check" CHECK("attempt_count" >= 0 and "next_attempt_at_ms" >= 0),
	CONSTRAINT "inbox_email_deliveries_claim_check" CHECK(("claim_id" is null and "claim_expires_at_ms" is null) or (length(trim("claim_id")) > 0 and "claim_expires_at_ms" is not null)),
	CONSTRAINT "inbox_email_deliveries_terminal_check" CHECK(("state" = 'sent' and "sent_at_ms" is not null and "message_id" is not null) or ("state" = 'failed' and "failed_at_ms" is not null and "last_error_code" is not null) or ("state" = 'suppressed' and "suppressed_at_ms" is not null and "suppressed_reason" is not null) or ("state" in ('pending', 'sending') and "sent_at_ms" is null and "failed_at_ms" is null and "suppressed_at_ms" is null)),
	CONSTRAINT "inbox_email_deliveries_timestamps_check" CHECK("created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_email_deliveries_item_unique` ON `inbox_email_deliveries` (`inbox_item_id`);--> statement-breakpoint
CREATE INDEX `inbox_email_deliveries_due_idx` ON `inbox_email_deliveries` (`state`,`next_attempt_at_ms`,`claim_expires_at_ms`);--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`attention` text NOT NULL,
	`importance` text NOT NULL,
	`title` text NOT NULL,
	`preview` text NOT NULL,
	`context_label` text,
	`source_kind` text NOT NULL,
	`source_key` text NOT NULL,
	`source_target_json` text NOT NULL,
	`resolution_status` text NOT NULL,
	`read_at_ms` integer,
	`cleared_at_ms` integer,
	`resolved_at_ms` integer,
	`occurred_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inbox_items_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "inbox_items_identity_non_empty_check" CHECK(length(trim("organization_id")) > 0 and length(trim("recipient_user_id")) > 0 and length(trim("source_key")) > 0),
	CONSTRAINT "inbox_items_kind_check" CHECK("kind" in ('space_message', 'space_reference', 'agent_reply', 'agent_interaction', 'wake_outcome', 'center_agent_update', 'document_review', 'system_issue')),
	CONSTRAINT "inbox_items_attention_check" CHECK("attention" in ('update', 'action_required')),
	CONSTRAINT "inbox_items_importance_check" CHECK("importance" in ('normal', 'urgent')),
	CONSTRAINT "inbox_items_source_kind_check" CHECK("source_kind" in ('space_signal', 'runtime_coordinator_interaction', 'remote_agent_native_delivery', 'organization_document_draft', 'system_attention_event')),
	CONSTRAINT "inbox_items_resolution_check" CHECK(("attention" = 'update' and "resolution_status" = 'not_applicable' and "resolved_at_ms" is null) or ("attention" = 'action_required' and "resolution_status" = 'open' and "resolved_at_ms" is null) or ("attention" = 'action_required' and "resolution_status" = 'resolved' and "resolved_at_ms" is not null)),
	CONSTRAINT "inbox_items_title_length_check" CHECK(length(trim("title")) between 1 and 160),
	CONSTRAINT "inbox_items_preview_length_check" CHECK(length(trim("preview")) between 1 and 500),
	CONSTRAINT "inbox_items_context_label_length_check" CHECK("context_label" is null or length(trim("context_label")) between 1 and 160),
	CONSTRAINT "inbox_items_source_target_json_check" CHECK(length("source_target_json") between 2 and 2048 and json_valid("source_target_json") and json_type("source_target_json") = 'object'),
	CONSTRAINT "inbox_items_timestamps_check" CHECK("occurred_at_ms" >= 0 and "created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("read_at_ms" is null or "read_at_ms" >= 0) and ("cleared_at_ms" is null or "cleared_at_ms" >= 0) and ("resolved_at_ms" is null or "resolved_at_ms" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_items_recipient_source_unique` ON `inbox_items` (`organization_id`,`recipient_user_id`,`source_kind`,`source_key`);--> statement-breakpoint
CREATE INDEX `inbox_items_recipient_list_idx` ON `inbox_items` (`organization_id`,`recipient_user_id`,`cleared_at_ms`,"occurred_at_ms" desc,"id" desc);--> statement-breakpoint
CREATE INDEX `inbox_items_recipient_unread_idx` ON `inbox_items` (`organization_id`,`recipient_user_id`,`read_at_ms`,`cleared_at_ms`,"occurred_at_ms" desc);--> statement-breakpoint
CREATE INDEX `inbox_items_recipient_action_idx` ON `inbox_items` (`organization_id`,`recipient_user_id`,`attention`,`resolution_status`,`cleared_at_ms`);--> statement-breakpoint
CREATE INDEX `inbox_items_source_resolution_idx` ON `inbox_items` (`organization_id`,`source_kind`,`source_key`,`resolution_status`);--> statement-breakpoint
CREATE TABLE `inbox_notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`urgent_email_enabled` integer DEFAULT true NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inbox_notification_preferences_user_non_empty_check" CHECK(length(trim("user_id")) > 0),
	CONSTRAINT "inbox_notification_preferences_enabled_check" CHECK("urgent_email_enabled" in (0, 1)),
	CONSTRAINT "inbox_notification_preferences_timestamps_check" CHECK("created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms")
);
