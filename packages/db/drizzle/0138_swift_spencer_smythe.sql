PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_center_agent_member_research_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`subject_user_id` text NOT NULL,
	`subject_display_name` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`failure_code` text,
	`report_result` text,
	`observed_language_tag` text,
	`created_at_ms` integer NOT NULL,
	`started_at_ms` integer,
	`finished_at_ms` integer,
	FOREIGN KEY (`batch_id`) REFERENCES `center_agent_member_research_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_member_research_tasks_position_check" CHECK("position" > 0),
	CONSTRAINT "center_agent_member_research_tasks_status_check" CHECK("status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "center_agent_member_research_tasks_timestamps_check" CHECK(("status" = 'queued' and "started_at_ms" is null and "finished_at_ms" is null) or ("status" = 'running' and "started_at_ms" is not null and "finished_at_ms" is null) or ("status" in ('completed', 'failed') and "started_at_ms" is not null and "finished_at_ms" is not null and "finished_at_ms" >= "started_at_ms")),
	CONSTRAINT "center_agent_member_research_tasks_failure_check" CHECK(("status" = 'failed' and "failure_code" is not null) or ("status" != 'failed' and "failure_code" is null)),
	CONSTRAINT "center_agent_member_research_tasks_report_result_check" CHECK("report_result" is null or "report_result" in ('evidence_backed', 'insufficient_evidence')),
	CONSTRAINT "center_agent_member_research_tasks_language_tag_check" CHECK("observed_language_tag" is null or length(trim("observed_language_tag")) between 2 and 64)
);
--> statement-breakpoint
INSERT INTO `__new_center_agent_member_research_tasks`("id", "batch_id", "subject_user_id", "subject_display_name", "position", "status", "failure_code", "report_result", "observed_language_tag", "created_at_ms", "started_at_ms", "finished_at_ms") SELECT "id", "batch_id", "subject_user_id", "subject_display_name", "position", "status", "failure_code", "report_result", "observed_language_tag", "created_at_ms", "started_at_ms", "finished_at_ms" FROM `center_agent_member_research_tasks`;--> statement-breakpoint
DROP TABLE `center_agent_member_research_tasks`;--> statement-breakpoint
ALTER TABLE `__new_center_agent_member_research_tasks` RENAME TO `center_agent_member_research_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_member_research_tasks_batch_subject_unique` ON `center_agent_member_research_tasks` (`batch_id`,`subject_user_id`);--> statement-breakpoint
CREATE INDEX `center_agent_member_research_tasks_batch_position_idx` ON `center_agent_member_research_tasks` (`batch_id`,`position`);--> statement-breakpoint
CREATE INDEX `center_agent_member_research_tasks_status_started_idx` ON `center_agent_member_research_tasks` (`status`,`started_at_ms`);