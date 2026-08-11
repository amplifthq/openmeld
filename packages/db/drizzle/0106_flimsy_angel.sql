PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_center_agent_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requester_user_id` text,
	`idempotency_key` text NOT NULL,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`origin_kind` text NOT NULL,
	`origin_destination_json` text,
	`origin_attribution_json` text,
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
	CONSTRAINT "center_agent_tasks_origin_attribution_check" CHECK("origin_attribution_json" is null or json_valid("origin_attribution_json")),
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
INSERT INTO `__new_center_agent_tasks`("id", "organization_id", "requester_user_id", "idempotency_key", "title", "goal", "origin_kind", "origin_destination_json", "origin_attribution_json", "status", "active_attempt_generation", "version", "created_at_ms", "updated_at_ms", "finished_at_ms") SELECT "id", "organization_id", "requester_user_id", "idempotency_key", "title", "goal", "origin_kind", "origin_destination_json", NULL, "status", "active_attempt_generation", "version", "created_at_ms", "updated_at_ms", "finished_at_ms" FROM `center_agent_tasks`;--> statement-breakpoint
DROP TABLE `center_agent_tasks`;--> statement-breakpoint
ALTER TABLE `__new_center_agent_tasks` RENAME TO `center_agent_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_tasks_org_requester_idempotency_unique` ON `center_agent_tasks` (`organization_id`,`requester_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `center_agent_tasks_requester_updated_idx` ON `center_agent_tasks` (`organization_id`,`requester_user_id`,`updated_at_ms`,`id`);--> statement-breakpoint
CREATE INDEX `center_agent_tasks_org_status_updated_idx` ON `center_agent_tasks` (`organization_id`,`status`,`updated_at_ms`);
