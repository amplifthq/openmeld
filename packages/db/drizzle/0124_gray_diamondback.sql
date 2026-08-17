CREATE TABLE `organization_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`opportunity_key` text NOT NULL,
	`title` text NOT NULL,
	`observation` text NOT NULL,
	`expected_benefit` text NOT NULL,
	`suggested_next_step` text NOT NULL,
	`evidence_json` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by_profile_id` text NOT NULL,
	`source_native_delivery_id` text,
	`decided_by_user_id` text,
	`created_at_ms` integer NOT NULL,
	`decided_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_opportunities_identity_non_empty_check" CHECK(length(trim("id")) > 0 and length(trim("organization_id")) > 0 and length(trim("recipient_user_id")) > 0 and length(trim("opportunity_key")) between 1 and 256 and length(trim("created_by_profile_id")) > 0 and ("source_native_delivery_id" is null or length(trim("source_native_delivery_id")) > 0)),
	CONSTRAINT "organization_opportunities_content_length_check" CHECK(length(trim("title")) between 1 and 160 and length(trim("observation")) between 1 and 1000 and length(trim("expected_benefit")) between 1 and 500 and length(trim("suggested_next_step")) between 1 and 500),
	CONSTRAINT "organization_opportunities_evidence_check" CHECK(length("evidence_json") between 3 and 8192 and json_valid("evidence_json") and json_type("evidence_json") = 'array' and json_array_length("evidence_json") between 1 and 8),
	CONSTRAINT "organization_opportunities_status_check" CHECK(("status" = 'open' and "decided_by_user_id" is null and "decided_at_ms" is null) or ("status" in ('accepted', 'deferred', 'dismissed') and "decided_by_user_id" is not null and "decided_at_ms" is not null)),
	CONSTRAINT "organization_opportunities_timestamps_check" CHECK("created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("decided_at_ms" is null or "decided_at_ms" >= "created_at_ms"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_opportunities_recipient_key_unique` ON `organization_opportunities` (`organization_id`,`recipient_user_id`,`opportunity_key`);--> statement-breakpoint
CREATE INDEX `organization_opportunities_recipient_status_updated_idx` ON `organization_opportunities` (`organization_id`,`recipient_user_id`,`status`,"updated_at_ms" desc);--> statement-breakpoint
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
	CONSTRAINT "inbox_items_kind_check" CHECK("kind" in ('space_message', 'space_reference', 'agent_reply', 'agent_interaction', 'wake_outcome', 'center_agent_update', 'center_agent_task', 'document_review', 'system_issue')),
	CONSTRAINT "inbox_items_attention_check" CHECK("attention" in ('update', 'action_required')),
	CONSTRAINT "inbox_items_importance_check" CHECK("importance" in ('normal', 'urgent')),
	CONSTRAINT "inbox_items_source_kind_check" CHECK("source_kind" in ('space_signal', 'runtime_coordinator_interaction', 'remote_agent_native_delivery', 'remote_agent_native_interaction', 'center_agent_task_event', 'organization_document_draft', 'organization_opportunity', 'system_attention_event')),
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
CREATE INDEX `inbox_items_recipient_list_idx` ON `inbox_items` (`organization_id`,`recipient_user_id`,`cleared_at_ms`,`occurred_at_ms`,`id`);--> statement-breakpoint
CREATE INDEX `inbox_items_recipient_unread_idx` ON `inbox_items` (`organization_id`,`recipient_user_id`,`read_at_ms`,`cleared_at_ms`,`occurred_at_ms`);--> statement-breakpoint
CREATE INDEX `inbox_items_recipient_action_idx` ON `inbox_items` (`organization_id`,`recipient_user_id`,`attention`,`resolution_status`,`cleared_at_ms`);--> statement-breakpoint
CREATE INDEX `inbox_items_source_resolution_idx` ON `inbox_items` (`organization_id`,`source_kind`,`source_key`,`resolution_status`);