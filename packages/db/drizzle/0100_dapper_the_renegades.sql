CREATE TABLE `center_agent_task_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`generation` integer NOT NULL,
	`execution_task_key` text NOT NULL,
	`task_handle_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`failure_code` text,
	`created_at_ms` integer NOT NULL,
	`started_at_ms` integer,
	`finished_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `center_agent_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_task_attempts_generation_check" CHECK("generation" > 0),
	CONSTRAINT "center_agent_task_attempts_status_check" CHECK("status" in ('queued', 'running', 'stopping', 'needs_attention', 'succeeded', 'failed', 'stopped')),
	CONSTRAINT "center_agent_task_attempts_lifecycle_check" CHECK(("status" = 'queued' and "started_at_ms" is null and "finished_at_ms" is null)
        or ("status" in ('running', 'stopping', 'needs_attention') and "started_at_ms" is not null and "finished_at_ms" is null)
        or ("status" in ('succeeded', 'failed', 'stopped') and "started_at_ms" is not null and "finished_at_ms" is not null and "finished_at_ms" >= "started_at_ms")),
	CONSTRAINT "center_agent_task_attempts_failure_check" CHECK(("status" = 'failed' and "failure_code" is not null)
        or ("status" != 'failed' and "failure_code" is null)),
	CONSTRAINT "center_agent_task_attempts_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_task_attempts_task_generation_unique` ON `center_agent_task_attempts` (`task_id`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_task_attempts_task_idempotency_unique` ON `center_agent_task_attempts` (`task_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_task_attempts_execution_task_unique` ON `center_agent_task_attempts` (`execution_task_key`);--> statement-breakpoint
CREATE INDEX `center_agent_task_attempts_task_generation_idx` ON `center_agent_task_attempts` (`task_id`,`generation`);--> statement-breakpoint
CREATE TABLE `center_agent_task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`attempt_generation` integer,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`text` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	`observed_at_ms` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `center_agent_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_task_events_attempt_generation_check" CHECK("attempt_generation" is null or "attempt_generation" > 0),
	CONSTRAINT "center_agent_task_events_kind_check" CHECK("kind" in ('task_created', 'requester_message', 'center_agent_update', 'needs_attention', 'stop_requested', 'task_succeeded', 'task_failed', 'task_stopped')),
	CONSTRAINT "center_agent_task_events_actor_check" CHECK("actor" in ('requester', 'center_agent', 'system')),
	CONSTRAINT "center_agent_task_events_text_non_empty_check" CHECK(length(trim("text")) > 0),
	CONSTRAINT "center_agent_task_events_observed_at_check" CHECK("observed_at_ms" >= "occurred_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_task_events_task_idempotency_unique` ON `center_agent_task_events` (`task_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `center_agent_task_events_task_occurred_idx` ON `center_agent_task_events` (`task_id`,`occurred_at_ms`,`observed_at_ms`,`id`);--> statement-breakpoint
CREATE TABLE `center_agent_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requester_user_id` text,
	`idempotency_key` text NOT NULL,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`origin_kind` text NOT NULL,
	`origin_destination_json` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`active_attempt_generation` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`finished_at_ms` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "center_agent_tasks_status_check" CHECK("status" in ('queued', 'running', 'stopping', 'needs_attention', 'succeeded', 'failed', 'stopped')),
	CONSTRAINT "center_agent_tasks_origin_check" CHECK(("origin_kind" = 'open_meld' and "origin_destination_json" is null)
        or ("origin_kind" = 'message_channel' and "origin_destination_json" is not null and json_valid("origin_destination_json"))),
	CONSTRAINT "center_agent_tasks_active_generation_check" CHECK("active_attempt_generation" is null or "active_attempt_generation" > 0),
	CONSTRAINT "center_agent_tasks_nonqueued_generation_check" CHECK("status" = 'queued' or "active_attempt_generation" is not null),
	CONSTRAINT "center_agent_tasks_version_check" CHECK("version" > 0),
	CONSTRAINT "center_agent_tasks_lifecycle_check" CHECK(("status" in ('queued', 'running', 'stopping', 'needs_attention') and "finished_at_ms" is null)
        or ("status" in ('succeeded', 'failed', 'stopped') and "finished_at_ms" is not null)),
	CONSTRAINT "center_agent_tasks_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms"),
	CONSTRAINT "center_agent_tasks_finished_at_check" CHECK("finished_at_ms" is null or "finished_at_ms" >= "created_at_ms"),
	CONSTRAINT "center_agent_tasks_title_non_empty_check" CHECK(length(trim("title")) > 0),
	CONSTRAINT "center_agent_tasks_goal_non_empty_check" CHECK(length(trim("goal")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_tasks_org_requester_idempotency_unique` ON `center_agent_tasks` (`organization_id`,`requester_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `center_agent_tasks_requester_updated_idx` ON `center_agent_tasks` (`organization_id`,`requester_user_id`,`updated_at_ms`,`id`);--> statement-breakpoint
CREATE INDEX `center_agent_tasks_org_status_updated_idx` ON `center_agent_tasks` (`organization_id`,`status`,`updated_at_ms`);--> statement-breakpoint
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
	CONSTRAINT "inbox_items_source_kind_check" CHECK("source_kind" in ('space_signal', 'runtime_coordinator_interaction', 'remote_agent_native_delivery', 'remote_agent_native_interaction', 'center_agent_task_event', 'organization_document_draft', 'system_attention_event')),
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