CREATE TABLE `agent_activity_daily_aggregates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`utc_date` text NOT NULL,
	`session_count` integer NOT NULL,
	`event_count` integer NOT NULL,
	`first_observed_at_ms` integer NOT NULL,
	`last_observed_at_ms` integer NOT NULL,
	`provider_counts_json` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_activity_daily_counts_check" CHECK("session_count" >= 0
        and "event_count" >= 0
        and "last_observed_at_ms" >= "first_observed_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_daily_scope_unique` ON `agent_activity_daily_aggregates` (`organization_id`,`project_id`,`member_user_id`,`utc_date`);--> statement-breakpoint
CREATE INDEX `agent_activity_daily_org_date_idx` ON `agent_activity_daily_aggregates` (`organization_id`,"utc_date" desc);--> statement-breakpoint
CREATE TABLE `agent_activity_daily_session_keys` (
	`daily_session_key` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`utc_date` text NOT NULL,
	`first_event_storage_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_activity_daily_session_key_hash_check" CHECK(length("daily_session_key") = 71
        and substr("daily_session_key", 1, 7) = 'sha256:'
        and substr("daily_session_key", 8) not glob '*[^0-9a-f]*'
        and "expires_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `agent_activity_daily_session_keys_expiry_idx` ON `agent_activity_daily_session_keys` (`expires_at_ms`);--> statement-breakpoint
CREATE TABLE `agent_activity_digests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_cursor_accepted_sequence` integer NOT NULL,
	`window_started_at_ms` integer NOT NULL,
	`window_ended_at_ms` integer NOT NULL,
	`event_count` integer NOT NULL,
	`citations_json` text NOT NULL,
	`summary` text,
	`status` text NOT NULL,
	`failure_reason` text,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_activity_digests_window_check" CHECK("window_ended_at_ms" >= "window_started_at_ms"
        and "source_cursor_accepted_sequence" > 0
        and "event_count" > 0
        and "expires_at_ms" >= "created_at_ms"),
	CONSTRAINT "agent_activity_digests_status_check" CHECK(("status" = 'pending' and "summary" is null and "failure_reason" is null)
        or ("status" = 'completed' and "summary" is not null and "failure_reason" is null)
        or ("status" = 'failed' and "summary" is null and "failure_reason" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_digests_source_cursor_unique` ON `agent_activity_digests` (`organization_id`,`project_id`,`source_cursor_accepted_sequence`);--> statement-breakpoint
CREATE INDEX `agent_activity_digests_org_created_idx` ON `agent_activity_digests` (`organization_id`,"created_at_ms" desc);--> statement-breakpoint
CREATE TABLE `agent_activity_events` (
	`accepted_sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`event_id` text NOT NULL,
	`canonical_payload_hash` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`openmeld_service_runtime_id` text NOT NULL,
	`provider` text NOT NULL,
	`client_kind` text NOT NULL,
	`provider_session_id` text NOT NULL,
	`event_type` text NOT NULL,
	`title` text,
	`model` text,
	`status` text NOT NULL,
	`git_branch` text,
	`git_commit` text,
	`repository_fingerprint` text,
	`started_at_ms` integer,
	`observed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`provider_metadata_json` text NOT NULL,
	`accepted_at_ms` integer NOT NULL,
	`daily_session_key` text NOT NULL,
	`daily_aggregated_at_ms` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_activity_events_payload_hash_check" CHECK(length("canonical_payload_hash") = 71
        and substr("canonical_payload_hash", 1, 7) = 'sha256:'
        and substr("canonical_payload_hash", 8) not glob '*[^0-9a-f]*'),
	CONSTRAINT "agent_activity_events_time_check" CHECK("observed_at_ms" >= 0
        and "expires_at_ms" >= "observed_at_ms"
        and "accepted_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_events_storage_id_unique` ON `agent_activity_events` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_events_org_event_unique` ON `agent_activity_events` (`organization_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_events_org_project_observed_idx` ON `agent_activity_events` (`organization_id`,`project_id`,"observed_at_ms" desc);--> statement-breakpoint
CREATE INDEX `agent_activity_events_org_member_observed_idx` ON `agent_activity_events` (`organization_id`,`member_user_id`,"observed_at_ms" desc);--> statement-breakpoint
CREATE INDEX `agent_activity_events_retention_idx` ON `agent_activity_events` (`observed_at_ms`);--> statement-breakpoint
CREATE INDEX `agent_activity_events_daily_aggregation_idx` ON `agent_activity_events` (`daily_aggregated_at_ms`,`observed_at_ms`);--> statement-breakpoint
CREATE TABLE `agent_activity_execution_links` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`activity_session_id` text NOT NULL,
	`runtime_coordinator_execution_id` text NOT NULL,
	`device_id` text NOT NULL,
	`openmeld_service_runtime_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`provider_conversation_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_session_id`) REFERENCES `agent_activity_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runtime_coordinator_execution_id`) REFERENCES `openMeldDaemon_runtime_coordinator_executions`(`runtime_coordinator_execution_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_execution_links_rce_unique` ON `agent_activity_execution_links` (`runtime_coordinator_execution_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_execution_links_session_rce_unique` ON `agent_activity_execution_links` (`activity_session_id`,`runtime_coordinator_execution_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_execution_links_org_created_idx` ON `agent_activity_execution_links` (`organization_id`,"created_at_ms" desc);--> statement-breakpoint
CREATE TABLE `agent_activity_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`openmeld_service_runtime_id` text NOT NULL,
	`provider` text NOT NULL,
	`client_kind` text NOT NULL,
	`provider_session_id` text NOT NULL,
	`title` text,
	`model` text,
	`status` text NOT NULL,
	`git_branch` text,
	`git_commit` text,
	`repository_fingerprint` text,
	`started_at_ms` integer,
	`last_observed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`provider_metadata_json` text NOT NULL,
	`last_event_id` text NOT NULL,
	`last_accepted_sequence` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_activity_sessions_time_check" CHECK("last_observed_at_ms" >= 0
        and "expires_at_ms" >= "last_observed_at_ms"
        and "last_accepted_sequence" > 0
        and "updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_sessions_identity_unique` ON `agent_activity_sessions` (`organization_id`,`member_user_id`,`device_id`,`provider`,`provider_session_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_sessions_org_active_idx` ON `agent_activity_sessions` (`organization_id`,"expires_at_ms" desc);--> statement-breakpoint
CREATE INDEX `agent_activity_sessions_org_project_active_idx` ON `agent_activity_sessions` (`organization_id`,`project_id`,"expires_at_ms" desc);
