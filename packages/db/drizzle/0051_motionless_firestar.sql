CREATE TABLE `agent_controller_task_lifecycle_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`task_key` text NOT NULL,
	`event_type` text NOT NULL,
	`source` text NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`processed_at_ms` integer,
	CONSTRAINT "agent_controller_task_events_identity_non_empty_check" CHECK(length(trim("event_id")) > 0 and length(trim("task_key")) > 0),
	CONSTRAINT "agent_controller_task_events_type_check" CHECK("event_type" in ('registered', 'completed', 'needs_attention')),
	CONSTRAINT "agent_controller_task_events_source_check" CHECK("source" in ('claude_notification', 'claude_session_start', 'claude_subagent_start', 'claude_subagent_stop', 'claude_task_completed', 'claude_task_created', 'codex_permission_request', 'codex_stop', 'codex_subagent_start', 'codex_subagent_stop', 'codex_user_prompt_submit')),
	CONSTRAINT "agent_controller_task_events_payload_non_empty_check" CHECK(length(trim("payload_json")) > 0),
	CONSTRAINT "agent_controller_task_events_times_check" CHECK("occurred_at_ms" >= 0 and "observed_at_ms" >= 0 and ("processed_at_ms" is null or "processed_at_ms" >= "observed_at_ms"))
);
--> statement-breakpoint
CREATE INDEX `agent_controller_task_events_task_observed_idx` ON `agent_controller_task_lifecycle_events` (`task_key`,"observed_at_ms" desc);--> statement-breakpoint
CREATE INDEX `agent_controller_task_events_unprocessed_idx` ON `agent_controller_task_lifecycle_events` (`processed_at_ms`,`observed_at_ms`);--> statement-breakpoint
CREATE TABLE `agent_controller_tasks` (
	`task_key` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`openmeld_service_runtime_id` text NOT NULL,
	`host_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`task_id` text NOT NULL,
	`task_handle_json` text NOT NULL,
	`registration_event_id` text NOT NULL,
	`registration_source` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "agent_controller_tasks_identity_non_empty_check" CHECK(length(trim("task_key")) > 0 and length(trim("host_id")) > 0 and length(trim("agent_controller_ref")) > 0 and length(trim("task_id")) > 0),
	CONSTRAINT "agent_controller_tasks_authority_non_empty_check" CHECK(length(trim("organization_id")) > 0 and length(trim("owner_user_id")) > 0 and length(trim("openmeld_service_runtime_id")) > 0),
	CONSTRAINT "agent_controller_tasks_payload_non_empty_check" CHECK(length(trim("task_handle_json")) > 0 and length(trim("registration_event_id")) > 0),
	CONSTRAINT "agent_controller_tasks_registration_source_check" CHECK("registration_source" in ('claude_session_start', 'claude_subagent_start', 'claude_task_created', 'codex_subagent_start', 'codex_user_prompt_submit')),
	CONSTRAINT "agent_controller_tasks_times_check" CHECK("occurred_at_ms" >= 0 and "observed_at_ms" >= 0 and "updated_at_ms" >= "observed_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_controller_tasks_registration_event_unique` ON `agent_controller_tasks` (`registration_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_controller_tasks_controller_identity_unique` ON `agent_controller_tasks` (`host_id`,`agent_controller_ref`,`task_id`);--> statement-breakpoint
CREATE INDEX `agent_controller_tasks_org_updated_idx` ON `agent_controller_tasks` (`organization_id`,"updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `agent_controller_tasks_runtime_updated_idx` ON `agent_controller_tasks` (`openmeld_service_runtime_id`,"updated_at_ms" desc);