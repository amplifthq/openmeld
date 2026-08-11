CREATE TABLE `agent_task_needs_attention_observations` (
	`task_key` text NOT NULL,
	`event_id` text NOT NULL,
	`task_handle_json` text NOT NULL,
	`status` text NOT NULL,
	`observation_json` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	`observed_at_ms` integer NOT NULL,
	PRIMARY KEY(`task_key`, `event_id`),
	CONSTRAINT "agent_task_needs_attention_observations_identity_non_empty_check" CHECK(length(trim("task_key")) > 0 and length(trim("event_id")) > 0),
	CONSTRAINT "agent_task_needs_attention_observations_payload_non_empty_check" CHECK(length(trim("task_handle_json")) > 0 and length(trim("observation_json")) > 0),
	CONSTRAINT "agent_task_needs_attention_observations_status_check" CHECK("status" = 'needs_attention'),
	CONSTRAINT "agent_task_needs_attention_observations_times_check" CHECK("occurred_at_ms" >= 0 and "observed_at_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX `agent_task_needs_attention_observations_task_occurred_idx` ON `agent_task_needs_attention_observations` (`task_key`,"occurred_at_ms" desc);--> statement-breakpoint
CREATE INDEX `agent_task_needs_attention_observations_observed_idx` ON `agent_task_needs_attention_observations` (`observed_at_ms`);