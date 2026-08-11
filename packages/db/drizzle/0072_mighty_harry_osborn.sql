PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_routines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`instructions` text NOT NULL,
	`authorized_actions_json` text DEFAULT '[]' NOT NULL,
	`external_action_policy` text DEFAULT 'standard' NOT NULL,
	`schedule_kind` text DEFAULT 'cron' NOT NULL,
	`cron_expression` text,
	`timezone` text,
	`run_at_ms` integer,
	`destination_kind` text DEFAULT 'space' NOT NULL,
	`target_space_id` text,
	`slack_team_id` text,
	`slack_channel_id` text,
	`slack_thread_ts` text,
	`slack_conversation_id` text,
	`slack_thread_label` text,
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
	CONSTRAINT "routines_external_action_policy_check" CHECK("external_action_policy" in ('standard', 'read_only')),
	CONSTRAINT "routines_schedule_kind_check" CHECK("schedule_kind" in ('cron', 'once')),
	CONSTRAINT "routines_cron_expression_non_empty_check" CHECK("cron_expression" is null or length(trim("cron_expression")) > 0),
	CONSTRAINT "routines_timezone_non_empty_check" CHECK("timezone" is null or length(trim("timezone")) > 0),
	CONSTRAINT "routines_schedule_fields_check" CHECK(("schedule_kind" = 'cron' and "cron_expression" is not null and "timezone" is not null and "run_at_ms" is null) or ("schedule_kind" = 'once' and "cron_expression" is null and "timezone" is null and "run_at_ms" is not null)),
	CONSTRAINT "routines_destination_kind_check" CHECK("destination_kind" in ('space', 'slack_thread')),
	CONSTRAINT "routines_target_space_non_empty_check" CHECK("target_space_id" is null or length(trim("target_space_id")) > 0),
	CONSTRAINT "routines_destination_fields_check" CHECK(("destination_kind" = 'space' and "target_space_id" is not null and "slack_team_id" is null and "slack_channel_id" is null and "slack_thread_ts" is null and "slack_conversation_id" is null) or ("destination_kind" = 'slack_thread' and "target_space_id" is null and "slack_team_id" is not null and "slack_channel_id" is not null and "slack_thread_ts" is not null and "slack_conversation_id" is not null)),
	CONSTRAINT "routines_status_check" CHECK("status" in ('enabled', 'paused', 'completed')),
	CONSTRAINT "routines_status_next_due_check" CHECK(("status" = 'enabled' and "next_due_at" is not null) or ("status" in ('paused', 'completed') and "next_due_at" is null)),
	CONSTRAINT "routines_creator_non_empty_check" CHECK(length(trim("created_by_user_id")) > 0),
	CONSTRAINT "routines_updater_non_empty_check" CHECK(length(trim("updated_by_user_id")) > 0),
	CONSTRAINT "routines_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_routines`("id", "organization_id", "name", "instructions", "authorized_actions_json", "external_action_policy", "schedule_kind", "cron_expression", "timezone", "run_at_ms", "destination_kind", "target_space_id", "slack_team_id", "slack_channel_id", "slack_thread_ts", "slack_conversation_id", "slack_thread_label", "status", "next_due_at", "created_by_user_id", "updated_by_user_id", "created_at_ms", "updated_at_ms") SELECT "id", "organization_id", "name", "instructions", "authorized_actions_json", "external_action_policy", "schedule_kind", "cron_expression", "timezone", "run_at_ms", "destination_kind", "target_space_id", "slack_team_id", "slack_channel_id", "slack_thread_ts", "slack_conversation_id", "slack_thread_label", "status", "next_due_at", "created_by_user_id", "updated_by_user_id", "created_at_ms", "updated_at_ms" FROM `routines`;--> statement-breakpoint
DROP TABLE `routines`;--> statement-breakpoint
ALTER TABLE `__new_routines` RENAME TO `routines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `routines_status_next_due_idx` ON `routines` (`status`,`next_due_at`);--> statement-breakpoint
CREATE INDEX `routines_org_status_next_due_idx` ON `routines` (`organization_id`,`status`,`next_due_at`);--> statement-breakpoint
CREATE INDEX `routines_org_updated_idx` ON `routines` (`organization_id`,`updated_at_ms` DESC);
