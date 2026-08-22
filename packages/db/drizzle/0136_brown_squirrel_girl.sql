ALTER TABLE `agent_profile_creation_requests` ADD `profile_creation_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_profile_creation_requests` ADD `profile_creation_started_at` integer;--> statement-breakpoint
ALTER TABLE `agent_profile_creation_requests` ADD `inbox_projection_operation` text;--> statement-breakpoint
ALTER TABLE `agent_profile_creation_requests` ADD `inbox_projection_generation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_profile_creation_requests` ADD `inbox_projection_status` text;--> statement-breakpoint
ALTER TABLE `agent_profile_creation_requests` ADD `inbox_projection_attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_profile_creation_requests` ADD `inbox_projection_last_error` text;--> statement-breakpoint
ALTER TABLE `agent_profile_creation_requests` ADD `inbox_projection_next_retry_at` integer;--> statement-breakpoint
ALTER TABLE `agent_profile_creation_requests` ADD `inbox_projection_completed_at` integer;--> statement-breakpoint
CREATE INDEX `agent_profile_creation_requests_inbox_projection_due_idx` ON `agent_profile_creation_requests` (`inbox_projection_status`,`inbox_projection_next_retry_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_profile_creation_requests_stale_execution_idx` ON `agent_profile_creation_requests` (`status`,`profile_creation_started_at`);