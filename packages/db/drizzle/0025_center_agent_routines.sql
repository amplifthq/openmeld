CREATE TABLE `routine_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`failure_detail` text,
	`native_delivery_id` text,
	`published_signal_id` text,
	`started_at_ms` integer,
	`finished_at_ms` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "routine_runs_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "routine_runs_routine_non_empty_check" CHECK(length(trim("routine_id")) > 0),
	CONSTRAINT "routine_runs_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "routine_runs_status_check" CHECK("status" in ('claimed', 'submitted', 'completed', 'failed', 'skipped')),
	CONSTRAINT "routine_runs_finished_at_valid_check" CHECK("finished_at_ms" is null or "started_at_ms" is null or "finished_at_ms" >= "started_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routine_runs_routine_scheduled_unique` ON `routine_runs` (`routine_id`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `routine_runs_org_scheduled_idx` ON `routine_runs` (`organization_id`,"scheduled_for" desc);--> statement-breakpoint
CREATE INDEX `routine_runs_routine_scheduled_idx` ON `routine_runs` (`routine_id`,"scheduled_for" desc);--> statement-breakpoint
CREATE INDEX `routine_runs_native_delivery_idx` ON `routine_runs` (`native_delivery_id`);--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`instructions` text NOT NULL,
	`schedule_kind` text DEFAULT 'cron' NOT NULL,
	`cron_expression` text NOT NULL,
	`timezone` text NOT NULL,
	`target_space_id` text NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`next_due_at` integer,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "routines_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "routines_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "routines_name_non_empty_check" CHECK(length(trim("name")) > 0),
	CONSTRAINT "routines_instructions_non_empty_check" CHECK(length(trim("instructions")) > 0),
	CONSTRAINT "routines_schedule_kind_check" CHECK("schedule_kind" = 'cron'),
	CONSTRAINT "routines_cron_expression_non_empty_check" CHECK(length(trim("cron_expression")) > 0),
	CONSTRAINT "routines_timezone_non_empty_check" CHECK(length(trim("timezone")) > 0),
	CONSTRAINT "routines_target_space_non_empty_check" CHECK(length(trim("target_space_id")) > 0),
	CONSTRAINT "routines_status_check" CHECK("status" in ('enabled', 'paused')),
	CONSTRAINT "routines_status_next_due_check" CHECK(("status" = 'enabled' and "next_due_at" is not null) or ("status" = 'paused' and "next_due_at" is null)),
	CONSTRAINT "routines_creator_non_empty_check" CHECK(length(trim("created_by_user_id")) > 0),
	CONSTRAINT "routines_updater_non_empty_check" CHECK(length(trim("updated_by_user_id")) > 0),
	CONSTRAINT "routines_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `routines_org_status_next_due_idx` ON `routines` (`organization_id`,`status`,`next_due_at`);--> statement-breakpoint
CREATE INDEX `routines_org_updated_idx` ON `routines` (`organization_id`,"updated_at_ms" desc);
