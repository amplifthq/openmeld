PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_activity_daily_aggregates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`utc_date` text NOT NULL,
	`active_duration_ms` integer DEFAULT 0 NOT NULL,
	`session_count` integer NOT NULL,
	`event_count` integer NOT NULL,
	`first_observed_at_ms` integer NOT NULL,
	`last_observed_at_ms` integer NOT NULL,
	`provider_counts_json` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_activity_daily_active_duration_check" CHECK("active_duration_ms" >= 0),
	CONSTRAINT "agent_activity_daily_counts_check" CHECK("session_count" >= 0
        and "event_count" >= 0
        and "last_observed_at_ms" >= "first_observed_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_agent_activity_daily_aggregates`("id", "organization_id", "project_id", "member_user_id", "utc_date", "active_duration_ms", "session_count", "event_count", "first_observed_at_ms", "last_observed_at_ms", "provider_counts_json", "updated_at_ms") SELECT "id", "organization_id", "project_id", "member_user_id", "utc_date", 0, "session_count", "event_count", "first_observed_at_ms", "last_observed_at_ms", "provider_counts_json", "updated_at_ms" FROM `agent_activity_daily_aggregates`;--> statement-breakpoint
DROP TABLE `agent_activity_daily_aggregates`;--> statement-breakpoint
ALTER TABLE `__new_agent_activity_daily_aggregates` RENAME TO `agent_activity_daily_aggregates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_daily_scope_unique` ON `agent_activity_daily_aggregates` (`organization_id`,`project_id`,`member_user_id`,`utc_date`);--> statement-breakpoint
CREATE INDEX `agent_activity_daily_org_date_idx` ON `agent_activity_daily_aggregates` (`organization_id`,`utc_date` desc);
