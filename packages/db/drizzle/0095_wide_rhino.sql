CREATE TABLE `center_agent_attention_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`space_id` text NOT NULL,
	`trigger_signal_id` text NOT NULL,
	`source_native_delivery_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`impact` text NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`resolved_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_attention_requests_identity_non_empty_check" CHECK(length(trim("id")) > 0 and length(trim("space_id")) > 0 and length(trim("trigger_signal_id")) > 0 and length(trim("source_native_delivery_id")) > 0 and length(trim("submission_id")) > 0),
	CONSTRAINT "center_agent_attention_requests_impact_check" CHECK("impact" in ('response_needed', 'work_blocked', 'material_failure_risk')),
	CONSTRAINT "center_agent_attention_requests_status_check" CHECK(("status" = 'open' and "resolved_at_ms" is null) or ("status" = 'resolved' and "resolved_at_ms" is not null)),
	CONSTRAINT "center_agent_attention_requests_copy_check" CHECK(length(trim("title")) between 1 and 160 and length(trim("prompt")) between 1 and 500),
	CONSTRAINT "center_agent_attention_requests_timestamps_check" CHECK("created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("resolved_at_ms" is null or "resolved_at_ms" >= "created_at_ms"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_attention_requests_submission_unique` ON `center_agent_attention_requests` (`submission_id`);--> statement-breakpoint
CREATE INDEX `center_agent_attention_requests_open_recipient_idx` ON `center_agent_attention_requests` (`organization_id`,`recipient_user_id`,`space_id`,`status`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_inbox_items` (
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
	CONSTRAINT "inbox_items_source_kind_check" CHECK("source_kind" in ('space_signal', 'runtime_coordinator_interaction', 'remote_agent_native_delivery', 'remote_agent_native_interaction', 'organization_document_draft', 'system_attention_event')),
	CONSTRAINT "inbox_items_resolution_check" CHECK(("attention" = 'update' and "resolution_status" = 'not_applicable' and "resolved_at_ms" is null) or ("attention" = 'action_required' and "resolution_status" = 'open' and "resolved_at_ms" is null) or ("attention" = 'action_required' and "resolution_status" = 'resolved' and "resolved_at_ms" is not null)),
	CONSTRAINT "inbox_items_title_length_check" CHECK(length(trim("title")) between 1 and 160),
	CONSTRAINT "inbox_items_preview_length_check" CHECK(length(trim("preview")) between 1 and 500),
	CONSTRAINT "inbox_items_context_label_length_check" CHECK("context_label" is null or length(trim("context_label")) between 1 and 160),
	CONSTRAINT "inbox_items_source_target_json_check" CHECK(length("source_target_json") between 2 and 2048 and json_valid("source_target_json") and json_type("source_target_json") = 'object'),
	CONSTRAINT "inbox_items_timestamps_check" CHECK("occurred_at_ms" >= 0 and "created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("read_at_ms" is null or "read_at_ms" >= 0) and ("cleared_at_ms" is null or "cleared_at_ms" >= 0) and ("resolved_at_ms" is null or "resolved_at_ms" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_inbox_items`("id", "organization_id", "recipient_user_id", "kind", "attention", "importance", "title", "preview", "context_label", "source_kind", "source_key", "source_target_json", "resolution_status", "read_at_ms", "cleared_at_ms", "resolved_at_ms", "occurred_at_ms", "created_at_ms", "updated_at_ms") SELECT "id", "organization_id", "recipient_user_id", "kind", "attention", "importance", "title", "preview", "context_label", "source_kind", "source_key", "source_target_json", "resolution_status", "read_at_ms", "cleared_at_ms", "resolved_at_ms", "occurred_at_ms", "created_at_ms", "updated_at_ms" FROM `inbox_items`;--> statement-breakpoint
DROP TABLE `inbox_items`;--> statement-breakpoint
ALTER TABLE `__new_inbox_items` RENAME TO `inbox_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_items_recipient_source_unique` ON `inbox_items` (`organization_id`,`recipient_user_id`,`source_kind`,`source_key`);--> statement-breakpoint
CREATE INDEX `inbox_items_recipient_list_idx` ON `inbox_items` (`organization_id`,`recipient_user_id`,`cleared_at_ms`,"occurred_at_ms" desc,"id" desc);--> statement-breakpoint
CREATE INDEX `inbox_items_recipient_unread_idx` ON `inbox_items` (`organization_id`,`recipient_user_id`,`read_at_ms`,`cleared_at_ms`,"occurred_at_ms" desc);--> statement-breakpoint
CREATE INDEX `inbox_items_recipient_action_idx` ON `inbox_items` (`organization_id`,`recipient_user_id`,`attention`,`resolution_status`,`cleared_at_ms`);--> statement-breakpoint
CREATE INDEX `inbox_items_source_resolution_idx` ON `inbox_items` (`organization_id`,`source_kind`,`source_key`,`resolution_status`);
