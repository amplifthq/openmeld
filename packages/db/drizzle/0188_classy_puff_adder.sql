CREATE TABLE `ai_usage_records` (
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`runtime` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`purpose` text NOT NULL,
	`agent_profile_id` text,
	`space_id` text,
	`task_id` text,
	`attempt_id` text,
	`computer_id` text,
	`controller` text,
	`occurred_at_ms` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`cost_nano_usd` integer,
	`cost_kind` text,
	`record_json` text NOT NULL,
	PRIMARY KEY(`organization_id`, `runtime`, `event_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_usage_records_org_time_idx` ON `ai_usage_records` (`organization_id`,`occurred_at_ms`);--> statement-breakpoint
CREATE INDEX `ai_usage_records_org_task_idx` ON `ai_usage_records` (`organization_id`,`task_id`,`occurred_at_ms`);--> statement-breakpoint
CREATE INDEX `ai_usage_records_org_computer_idx` ON `ai_usage_records` (`organization_id`,`computer_id`,`occurred_at_ms`);--> statement-breakpoint
CREATE TABLE `organization_ai_usage_policies` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`daily_limit_nano_usd` integer,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
