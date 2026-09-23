CREATE TABLE `github_app_webhook_deliveries` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`action` text,
	`owner_login` text,
	`repo` text,
	`number` integer,
	`issue_state` text,
	`gateway_request_id` text NOT NULL,
	`state` text NOT NULL,
	`claim_id` text,
	`claim_expires_at_ms` integer,
	`first_received_at_ms` integer NOT NULL,
	`last_received_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	`failure_code` text,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "github_app_webhook_deliveries_id_check" CHECK(length(trim("delivery_id")) > 0),
	CONSTRAINT "github_app_webhook_deliveries_state_check" CHECK("state" in ('queued', 'processing', 'completed', 'failed', 'ignored')),
	CONSTRAINT "github_app_webhook_deliveries_issue_state_check" CHECK("issue_state" is null or "issue_state" in ('open', 'closed')),
	CONSTRAINT "github_app_webhook_deliveries_time_check" CHECK("first_received_at_ms" >= 0 and "last_received_at_ms" >= "first_received_at_ms" and "updated_at_ms" >= 0 and ("completed_at_ms" is null or "completed_at_ms" >= "first_received_at_ms"))
);
--> statement-breakpoint
CREATE INDEX `github_app_webhook_deliveries_state_idx` ON `github_app_webhook_deliveries` (`state`,`updated_at_ms`);--> statement-breakpoint
CREATE TABLE `space_task_github_issue_links` (
	`space_id` text NOT NULL,
	`task_id` text NOT NULL,
	`provider` text NOT NULL,
	`owner_login` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`url` text NOT NULL,
	`organization_id` text NOT NULL,
	`attached_at_ms` integer NOT NULL,
	`detached_at_ms` integer,
	`last_observed_state` text,
	`last_observed_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`space_id`, `task_id`, `provider`, `owner_login`, `repo`, `number`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "space_task_github_issue_links_provider_check" CHECK("provider" = 'github'),
	CONSTRAINT "space_task_github_issue_links_ids_check" CHECK(length(trim("space_id")) > 0 and "task_id" glob 'tsk_*' and length(trim("owner_login")) > 0 and length(trim("repo")) > 0 and "number" > 0),
	CONSTRAINT "space_task_github_issue_links_url_check" CHECK(length(trim("url")) > 0),
	CONSTRAINT "space_task_github_issue_links_state_check" CHECK("last_observed_state" is null or "last_observed_state" in ('open', 'closed')),
	CONSTRAINT "space_task_github_issue_links_time_check" CHECK("attached_at_ms" >= 0 and "updated_at_ms" >= "attached_at_ms" and ("detached_at_ms" is null or "detached_at_ms" >= "attached_at_ms") and ("last_observed_at_ms" is null or "last_observed_at_ms" >= 0))
);
--> statement-breakpoint
CREATE INDEX `space_task_github_issue_links_identity_idx` ON `space_task_github_issue_links` (`provider`,`owner_login`,`repo`,`number`,`detached_at_ms`);