PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_task_terminal_outcomes` (
	`task_key` text PRIMARY KEY NOT NULL,
	`task_handle_json` text NOT NULL,
	`status` text NOT NULL,
	`event_id` text NOT NULL,
	`outcome_json` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	`observed_at_ms` integer NOT NULL,
	CONSTRAINT "agent_task_terminal_outcomes_task_key_non_empty_check" CHECK(length(trim("task_key")) > 0),
	CONSTRAINT "agent_task_terminal_outcomes_handle_non_empty_check" CHECK(length(trim("task_handle_json")) > 0),
	CONSTRAINT "agent_task_terminal_outcomes_status_check" CHECK("status" in ('succeeded', 'completed', 'failed', 'stopped', 'stayed_silent', 'publication_failed')),
	CONSTRAINT "agent_task_terminal_outcomes_event_non_empty_check" CHECK(length(trim("event_id")) > 0),
	CONSTRAINT "agent_task_terminal_outcomes_outcome_non_empty_check" CHECK(length(trim("outcome_json")) > 0),
	CONSTRAINT "agent_task_terminal_outcomes_times_check" CHECK("occurred_at_ms" >= 0 and "observed_at_ms" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_agent_task_terminal_outcomes`("task_key", "task_handle_json", "status", "event_id", "outcome_json", "occurred_at_ms", "observed_at_ms") SELECT "task_key", "task_handle_json", "status", "event_id", "outcome_json", "occurred_at_ms", "observed_at_ms" FROM `agent_task_terminal_outcomes`;--> statement-breakpoint
DROP TABLE `agent_task_terminal_outcomes`;--> statement-breakpoint
ALTER TABLE `__new_agent_task_terminal_outcomes` RENAME TO `agent_task_terminal_outcomes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_task_terminal_outcomes_event_idx` ON `agent_task_terminal_outcomes` (`event_id`);--> statement-breakpoint
CREATE INDEX `agent_task_terminal_outcomes_status_observed_idx` ON `agent_task_terminal_outcomes` (`status`,"observed_at_ms" desc);
