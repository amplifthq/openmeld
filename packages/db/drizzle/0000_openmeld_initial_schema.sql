CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_userId_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `device_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`client_id` text,
	`scope` text
);
--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkeys_userId_idx` ON `passkeys` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkeys_credentialID_idx` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_userId_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `space_index_memberships` (
	`space_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`profile_kind_snapshot` text NOT NULL,
	`profile_name_snapshot` text NOT NULL,
	`owner_user_id_snapshot` text,
	`owner_name_snapshot` text,
	`controller_ref_snapshot` text,
	`status` text NOT NULL,
	`member_source` text NOT NULL,
	`added_at_ms` integer NOT NULL,
	`removed_at_ms` integer,
	`added_by_profile_id` text,
	`added_by_owner_user_id` text,
	`added_by_display_name_snapshot` text,
	`removed_by_profile_id` text,
	`removed_by_owner_user_id` text,
	`removal_reason` text,
	`first_entered_at_ms` integer,
	`last_entered_at_ms` integer,
	`overlay_gateway_host` text,
	`overlay_pinned_at_ms` integer,
	`overlay_last_joined_at_ms` integer,
	`overlay_last_seen_ts` integer,
	`overlay_updated_at_ms` integer,
	`source_updated_at_ms` integer NOT NULL,
	`projected_at_ms` integer NOT NULL,
	`projection_event_id` text NOT NULL,
	PRIMARY KEY(`space_id`, `profile_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_space_index_memberships_profile_status_updated` ON `space_index_memberships` (`profile_id`,`status`,"source_updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_space_index_memberships_owner_status_updated` ON `space_index_memberships` (`owner_user_id_snapshot`,`status`,"source_updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_space_index_memberships_space_status` ON `space_index_memberships` (`space_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_space_index_memberships_projection_event` ON `space_index_memberships` (`projection_event_id`);--> statement-breakpoint
CREATE TABLE `space_index_projection_events` (
	`projection_event_id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`event_type` text NOT NULL,
	`source_updated_at_ms` integer NOT NULL,
	`projected_at_ms` integer NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_space_index_projection_events_space_source` ON `space_index_projection_events` (`space_id`,"source_updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_space_index_projection_events_type_source` ON `space_index_projection_events` (`event_type`,"source_updated_at_ms" desc);--> statement-breakpoint
CREATE TABLE `space_index_spaces` (
	`space_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`space_name` text,
	`space_purpose` text,
	`creator_profile_id` text,
	`creator_kind` text,
	`creator_owner_user_id` text,
	`creator_profile_name` text,
	`space_created_at_ms` integer,
	`space_updated_at_ms` integer,
	`deleted_at_ms` integer,
	`deleted_by_profile_id` text,
	`deleted_by_owner_user_id` text,
	`deleted_by_profile_name` text,
	`source_updated_at_ms` integer NOT NULL,
	`projected_at_ms` integer NOT NULL,
	`projection_event_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_space_index_spaces_status_updated` ON `space_index_spaces` (`status`,"source_updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_space_index_spaces_creator_owner` ON `space_index_spaces` (`creator_owner_user_id`,`status`,"source_updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_space_index_spaces_projection_event` ON `space_index_spaces` (`projection_event_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`username` text,
	`display_username` text,
	`normalized_email` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_email_unique` ON `users` (`normalized_email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_agent_execution_readiness_impacts` (
	`impact_id` text PRIMARY KEY NOT NULL,
	`impact_kind` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`openmeld_service_runtime_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`reason_code` text NOT NULL,
	`source` text NOT NULL,
	`source_dispatch_id` text NOT NULL,
	`source_attempt_id` text NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`cleared_at_ms` integer,
	`cleared_by_dispatch_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_agent_execution_readiness_impacts_target_kind_unique` ON `openMeldDaemon_agent_execution_readiness_impacts` (`agent_profile_id`,`binding_id`,`openmeld_service_runtime_id`,`agent_controller_ref`,`impact_kind`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_agent_execution_readiness_impacts_readiness` ON `openMeldDaemon_agent_execution_readiness_impacts` (`agent_profile_id`,`binding_id`,`openmeld_service_runtime_id`,`agent_controller_ref`,`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_agent_execution_readiness_impacts_source_dispatch` ON `openMeldDaemon_agent_execution_readiness_impacts` (`source_dispatch_id`,`source_attempt_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_agent_execution_readiness_impacts_observed` ON `openMeldDaemon_agent_execution_readiness_impacts` (`impact_kind`,"observed_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_agent_profile_bindings` (
	`binding_id` text PRIMARY KEY NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`openmeld_service_runtime_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`agent_controller_conversation_id` text,
	`model_id` text,
	`reasoning_level` text,
	`agent_controller_permission_mode` text,
	`binding_state` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`disabled_at_ms` integer,
	`created_by_profile_id` text,
	`reason_code` text,
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_binding_id_non_empty_check" CHECK(length(trim("binding_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_owner_kind_check" CHECK("owner_kind" in ('owner_account')),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_owner_id_non_empty_check" CHECK(length(trim("owner_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_agent_profile_id_non_empty_check" CHECK(length(trim("agent_profile_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_openmeld_service_runtime_id_non_empty_check" CHECK(length(trim("openmeld_service_runtime_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_agent_controller_ref_non_empty_check" CHECK(length(trim("agent_controller_ref")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_agent_controller_conversation_id_non_empty_check" CHECK("agent_controller_conversation_id" is null or length(trim("agent_controller_conversation_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_state_check" CHECK("binding_state" in ('enabled_primary', 'disabled_historical')),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_created_at_positive_check" CHECK("created_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms"),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_disabled_at_positive_check" CHECK("disabled_at_ms" is null or "disabled_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_lifecycle_check" CHECK((("binding_state" = 'enabled_primary' and "disabled_at_ms" is null) or ("binding_state" = 'disabled_historical' and "disabled_at_ms" is not null))),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_created_by_non_empty_check" CHECK("created_by_profile_id" is null or length(trim("created_by_profile_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_reason_code_check" CHECK("reason_code" is null or (length(trim("reason_code")) > 0 and length("reason_code") <= 160))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_agent_profile_bindings_enabled_primary_unique` ON `openMeldDaemon_agent_profile_bindings` (`owner_kind`,`owner_id`,`agent_profile_id`) WHERE "binding_state" = 'enabled_primary';--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_agent_profile_bindings_openmeld_service_runtime_agent_controller` ON `openMeldDaemon_agent_profile_bindings` (`openmeld_service_runtime_id`,`agent_controller_ref`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_agent_profile_bindings_owner_profile_state` ON `openMeldDaemon_agent_profile_bindings` (`owner_kind`,`owner_id`,`agent_profile_id`,`binding_state`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_connected_computers` (
	`owner_user_id` text NOT NULL,
	`connected_computer_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_connected_computers_owner_computer_unique` ON `openMeldDaemon_connected_computers` (`owner_user_id`,`connected_computer_id`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_current_device_targets` (
	`owner_user_id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`runtime_lane` text,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `openMeldDaemon_dispatch_attempts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`dispatch_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`status` text NOT NULL,
	`daemon_session_id` text,
	`connection_generation` integer,
	`lease_epoch` integer,
	`task_id` text,
	`target_profile_id` text,
	`execution_identity_model_version` text,
	`execution_binding_id` text,
	`execution_openmeld_service_runtime_id` text,
	`execution_agent_controller_ref` text,
	`created_at_ms` integer NOT NULL,
	`started_at_ms` integer,
	`finished_at_ms` integer,
	`error_code` text,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_attempts_dispatch_attempt_no` ON `openMeldDaemon_dispatch_attempts` (`dispatch_id`,"attempt_no" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_attempts_status_created` ON `openMeldDaemon_dispatch_attempts` (`status`,"created_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_dispatch_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idempotency_key` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`space_id` text NOT NULL,
	`source_event_id` text NOT NULL,
	`source_client_message_id` text,
	`dispatch_owner_kind` text,
	`dispatch_owner_id` text,
	`target_profile_id` text NOT NULL,
	`status` text NOT NULL,
	`first_seen_at_ms` integer NOT NULL,
	`last_attempt_at_ms` integer NOT NULL,
	`attempt_count` integer NOT NULL,
	`latest_attempt_id` text,
	`reply_hint_sent_at_ms` integer,
	`final_reply_sent_at_ms` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_dispatch_ledger_idempotency_key_unique` ON `openMeldDaemon_dispatch_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_ledger_dispatch_id` ON `openMeldDaemon_dispatch_ledger` (`dispatch_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_ledger_space_source_target` ON `openMeldDaemon_dispatch_ledger` (`space_id`,`source_event_id`,`target_profile_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_ledger_space_client_message_target` ON `openMeldDaemon_dispatch_ledger` (`space_id`,`source_client_message_id`,`target_profile_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_ledger_status_last_attempt` ON `openMeldDaemon_dispatch_ledger` (`status`,`last_attempt_at_ms`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_dispatch_result_inbox` (
	`result_key` text PRIMARY KEY NOT NULL,
	`dispatch_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`task_id` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`daemon_session_id` text NOT NULL,
	`lease_epoch` integer NOT NULL,
	`submitted_connection_generation` integer NOT NULL,
	`runtime_coordinator_execution_id` text,
	`execution_token_run_id` text,
	`execution_token_fingerprint` text,
	`result_payload_json` text NOT NULL,
	`accepted_at_ms` integer NOT NULL,
	`publish_state` text NOT NULL,
	`published_signal_id` text,
	`publication_error_code` text,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_result_inbox_dispatch_attempt` ON `openMeldDaemon_dispatch_result_inbox` (`dispatch_id`,`attempt_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_result_inbox_publish_state` ON `openMeldDaemon_dispatch_result_inbox` (`publish_state`,"updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_result_inbox_runtime_coordinator` ON `openMeldDaemon_dispatch_result_inbox` (`runtime_coordinator_execution_id`,`execution_token_run_id`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_dispatch_results` (
	`result_ref` text PRIMARY KEY NOT NULL,
	`dispatch_id` text NOT NULL,
	`space_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`actor_name` text,
	`reply_to_signal_id` text,
	`result_kind` text NOT NULL,
	`final_text` text,
	`message_envelope_json` text,
	`status_type` text,
	`preview_text` text,
	`public_outcome` text NOT NULL,
	`published_signal_id` text,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_dispatch_results_dispatch_id_unique` ON `openMeldDaemon_dispatch_results` (`dispatch_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_results_space_created` ON `openMeldDaemon_dispatch_results` (`space_id`,"created_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dispatch_results_actor_created` ON `openMeldDaemon_dispatch_results` (`actor_profile_id`,"created_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_dlq` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dispatch_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`source_event_id` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`error_code` text NOT NULL,
	`error_message` text,
	`failed_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_dlq_failed_at` ON `openMeldDaemon_dlq` (`failed_at_ms`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_forgotten_devices` (
	`owner_user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`forgotten_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_forgotten_devices_owner_device_unique` ON `openMeldDaemon_forgotten_devices` (`owner_user_id`,`device_id`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_ops_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_code` text NOT NULL,
	`decision_payload_json` text NOT NULL,
	`decided_by` text NOT NULL,
	`decided_at_ms` integer NOT NULL,
	`expected_recovery_criteria` text,
	`source` text NOT NULL,
	`correlation_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_openMeldDaemon_ops_decisions_correlation_code` ON `openMeldDaemon_ops_decisions` (`correlation_id`,`decision_code`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_ops_decisions_time` ON `openMeldDaemon_ops_decisions` ("decided_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_ops_decisions_code_time` ON `openMeldDaemon_ops_decisions` (`decision_code`,"decided_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_ops_decisions_correlation_time` ON `openMeldDaemon_ops_decisions` (`correlation_id`,"decided_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_ops_decisions_correlation_code_time` ON `openMeldDaemon_ops_decisions` (`correlation_id`,`decision_code`,"decided_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_owned_devices` (
	`owner_user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`connected_computer_id` text,
	`observed_display_name` text,
	`user_display_name` text,
	`platform_family` text,
	`os_version` text,
	`device_type` text,
	`first_seen_at_ms` integer NOT NULL,
	`last_observed_at_ms` integer,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_owned_devices_owner_device_unique` ON `openMeldDaemon_owned_devices` (`owner_user_id`,`device_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_owned_devices_owner_connected_computer` ON `openMeldDaemon_owned_devices` (`owner_user_id`,`connected_computer_id`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_prepare_session_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`prepare_session_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`session_revision` integer NOT NULL,
	`event_type` text NOT NULL,
	`actor` text NOT NULL,
	`event_json` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_prepare_session_events_session_created` ON `openMeldDaemon_prepare_session_events` (`prepare_session_id`,`created_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_prepare_session_events_owner_created` ON `openMeldDaemon_prepare_session_events` (`owner_user_id`,"created_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_prepare_session_tokens` (
	`token_digest` text PRIMARY KEY NOT NULL,
	`prepare_session_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`issued_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`revoked_at_ms` integer
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_prepare_session_tokens_session_active` ON `openMeldDaemon_prepare_session_tokens` (`prepare_session_id`,`revoked_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_prepare_session_tokens_owner_issued` ON `openMeldDaemon_prepare_session_tokens` (`owner_user_id`,"issued_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_prepare_sessions` (
	`prepare_session_id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`human_profile_id` text,
	`device_id` text,
	`runtime_lane` text,
	`target_space_id` text,
	`lifecycle_status` text NOT NULL,
	`phase` text NOT NULL,
	`session_revision` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`diagnostic_correlation_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	`expires_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_prepare_sessions_owner_status_updated` ON `openMeldDaemon_prepare_sessions` (`owner_user_id`,`lifecycle_status`,"updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_prepare_sessions_device_status_updated` ON `openMeldDaemon_prepare_sessions` (`owner_user_id`,`device_id`,`lifecycle_status`,"updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_prepare_sessions_expires` ON `openMeldDaemon_prepare_sessions` (`expires_at_ms`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_provider_access_evidence` (
	`evidence_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`openmeld_service_runtime_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`reason_code` text NOT NULL,
	`source` text NOT NULL,
	`source_dispatch_id` text NOT NULL,
	`source_attempt_id` text NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`cleared_at_ms` integer,
	`cleared_by_dispatch_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_provider_access_evidence_execution_provider_unique` ON `openMeldDaemon_provider_access_evidence` (`agent_profile_id`,`binding_id`,`openmeld_service_runtime_id`,`agent_controller_ref`,`provider`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_provider_access_evidence_readiness` ON `openMeldDaemon_provider_access_evidence` (`agent_profile_id`,`binding_id`,`openmeld_service_runtime_id`,`agent_controller_ref`,`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_provider_access_evidence_source_dispatch` ON `openMeldDaemon_provider_access_evidence` (`source_dispatch_id`,`source_attempt_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_provider_access_evidence_observed` ON `openMeldDaemon_provider_access_evidence` (`provider`,"observed_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_provider_conversation_proofs` (
	`proof_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`openmeld_service_runtime_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`agent_controller_conversation_id` text NOT NULL,
	`transport_mode` text NOT NULL,
	`intrusive` integer NOT NULL,
	`error_code` text,
	`error_type` text,
	`error_message` text,
	`observed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldDaemon_provider_conversation_proofs_provider_check" CHECK("provider" = 'codex'),
	CONSTRAINT "openMeldDaemon_provider_conversation_proofs_method_check" CHECK("method" = 'codex_app_server_thread_resume'),
	CONSTRAINT "openMeldDaemon_provider_conversation_proofs_status_check" CHECK("status" in ('passed', 'failed')),
	CONSTRAINT "openMeldDaemon_provider_conversation_proofs_transport_mode_check" CHECK("transport_mode" = 'codex-app-server'),
	CONSTRAINT "openMeldDaemon_provider_conversation_proofs_intrusive_false_check" CHECK("intrusive" = 0),
	CONSTRAINT "openMeldDaemon_provider_conversation_proofs_observed_at_positive_check" CHECK("observed_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_provider_conversation_proofs_expires_after_observed_check" CHECK("expires_at_ms" > "observed_at_ms"),
	CONSTRAINT "openMeldDaemon_provider_conversation_proofs_created_at_positive_check" CHECK("created_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_provider_conversation_proofs_updated_at_positive_check" CHECK("updated_at_ms" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_provider_conversation_proofs_target_method_unique` ON `openMeldDaemon_provider_conversation_proofs` (`agent_profile_id`,`binding_id`,`openmeld_service_runtime_id`,`agent_controller_ref`,`agent_controller_conversation_id`,`provider`,`method`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_provider_conversation_proofs_readiness` ON `openMeldDaemon_provider_conversation_proofs` (`agent_profile_id`,`binding_id`,`openmeld_service_runtime_id`,`agent_controller_ref`,`agent_controller_conversation_id`,`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_provider_conversation_proofs_observed` ON `openMeldDaemon_provider_conversation_proofs` (`provider`,`method`,"observed_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_runtime_agent_controller_reports` (
	`openmeld_service_runtime_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`report_status` text NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`reported_reason_codes_json` text NOT NULL,
	`agent_controller_interface_json` text,
	`accepted_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_openmeld_service_runtime_id_non_empty_check" CHECK(length(trim("openmeld_service_runtime_id")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_agent_controller_ref_non_empty_check" CHECK(length(trim("agent_controller_ref")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_status_check" CHECK("report_status" in ('ready', 'disabled', 'unavailable', 'unknown')),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_observed_at_positive_check" CHECK("observed_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_expires_after_observed_check" CHECK("expires_at_ms" > "observed_at_ms"),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_accepted_at_positive_check" CHECK("accepted_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_updated_at_positive_check" CHECK("updated_at_ms" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_runtime_agent_controller_reports_runtime_agent_controller_unique` ON `openMeldDaemon_runtime_agent_controller_reports` (`openmeld_service_runtime_id`,`agent_controller_ref`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_runtime_agent_controller_reports_runtime_expires` ON `openMeldDaemon_runtime_agent_controller_reports` (`openmeld_service_runtime_id`,`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_runtime_agent_controller_reports_agent_controller_status_expires` ON `openMeldDaemon_runtime_agent_controller_reports` (`agent_controller_ref`,`report_status`,`expires_at_ms`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_runtime_coordinator_creation_diagnostics` (
	`diagnostic_id` text PRIMARY KEY NOT NULL,
	`model_version` text NOT NULL,
	`space_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`source_client_message_id` text,
	`creation_status` text NOT NULL,
	`reason_code` text NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`legacy_attempt_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_rce_diag_space_dispatch_target` ON `openMeldDaemon_runtime_coordinator_creation_diagnostics` (`space_id`,`dispatch_id`,`target_profile_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_rce_diag_space_client_target` ON `openMeldDaemon_runtime_coordinator_creation_diagnostics` (`space_id`,`source_client_message_id`,`target_profile_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_rce_diag_reason_observed` ON `openMeldDaemon_runtime_coordinator_creation_diagnostics` (`reason_code`,"observed_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_runtime_coordinator_execution_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`runtime_coordinator_execution_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status_after` text,
	`reason_code` text,
	`observed_at_ms` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_rce_events_execution_observed` ON `openMeldDaemon_runtime_coordinator_execution_events` (`runtime_coordinator_execution_id`,"observed_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_rce_events_type_observed` ON `openMeldDaemon_runtime_coordinator_execution_events` (`event_type`,"observed_at_ms" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_rce_events_idempotency_unique` ON `openMeldDaemon_runtime_coordinator_execution_events` (`runtime_coordinator_execution_id`,`event_type`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_runtime_coordinator_executions` (
	`runtime_coordinator_execution_id` text PRIMARY KEY NOT NULL,
	`model_version` text NOT NULL,
	`space_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`source_client_message_id` text,
	`openmeld_service_runtime_id_source` text NOT NULL,
	`openmeld_service_runtime_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`status` text NOT NULL,
	`terminal_outcome_json` text,
	`attempt_id` text,
	`claim_lease_id` text,
	`daemon_session_id` text,
	`connection_generation` integer,
	`lease_epoch` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_rce_space_dispatch_target` ON `openMeldDaemon_runtime_coordinator_executions` (`space_id`,`dispatch_id`,`target_profile_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_rce_space_client_target` ON `openMeldDaemon_runtime_coordinator_executions` (`space_id`,`source_client_message_id`,`target_profile_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_rce_runtime_updated` ON `openMeldDaemon_runtime_coordinator_executions` (`openmeld_service_runtime_id`,"updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_rce_status_updated` ON `openMeldDaemon_runtime_coordinator_executions` (`status`,"updated_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_runtime_registry_records` (
	`openmeld_service_runtime_id` text PRIMARY KEY NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`device_id` text NOT NULL,
	`lane` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`last_registered_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldDaemon_runtime_registry_records_owner_kind_check" CHECK("owner_kind" in ('owner_account')),
	CONSTRAINT "openMeldDaemon_runtime_registry_records_openmeld_service_runtime_id_non_empty_check" CHECK(length(trim("openmeld_service_runtime_id")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_registry_records_owner_id_non_empty_check" CHECK(length(trim("owner_id")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_registry_records_device_id_non_empty_check" CHECK(length(trim("device_id")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_registry_records_lane_non_empty_check" CHECK(length(trim("lane")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_runtime_registry_records_owner_device_lane_unique` ON `openMeldDaemon_runtime_registry_records` (`owner_kind`,`owner_id`,`device_id`,`lane`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_slack_inbound_events` (
	`slack_event_id` text PRIMARY KEY NOT NULL,
	`installation_id` text NOT NULL,
	`slack_team_id` text NOT NULL,
	`slack_app_id` text NOT NULL,
	`slack_bot_user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_time` integer NOT NULL,
	`slack_channel_id` text NOT NULL,
	`slack_message_ts` text NOT NULL,
	`slack_thread_ts` text NOT NULL,
	`slack_user_id` text NOT NULL,
	`slack_text` text NOT NULL,
	`payload_json` text NOT NULL,
	`received_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldDaemon_slack_inbound_events_slack_event_id_non_empty_check" CHECK(length(trim("slack_event_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_installation_id_non_empty_check" CHECK(length(trim("installation_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_slack_team_id_non_empty_check" CHECK(length(trim("slack_team_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_slack_app_id_non_empty_check" CHECK(length(trim("slack_app_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_slack_bot_user_id_non_empty_check" CHECK(length(trim("slack_bot_user_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_event_type_check" CHECK("event_type" in ('app_mention')),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_event_time_positive_check" CHECK("event_time" > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_slack_channel_id_non_empty_check" CHECK(length(trim("slack_channel_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_slack_message_ts_non_empty_check" CHECK(length(trim("slack_message_ts")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_slack_thread_ts_non_empty_check" CHECK(length(trim("slack_thread_ts")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_slack_user_id_non_empty_check" CHECK(length(trim("slack_user_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_slack_text_non_empty_check" CHECK(length(trim("slack_text")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_payload_json_non_empty_check" CHECK(length(trim("payload_json")) > 0),
	CONSTRAINT "openMeldDaemon_slack_inbound_events_received_at_positive_check" CHECK("received_at_ms" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_slack_inbound_events_installation_received` ON `openMeldDaemon_slack_inbound_events` (`installation_id`,"received_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_slack_inbound_events_team_app_received` ON `openMeldDaemon_slack_inbound_events` (`slack_team_id`,`slack_app_id`,"received_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_slack_installations` (
	`installation_id` text PRIMARY KEY NOT NULL,
	`installation_status` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`assistant_profile_id` text NOT NULL,
	`space_id` text NOT NULL,
	`space_url` text NOT NULL,
	`slack_team_id` text NOT NULL,
	`slack_team_name` text,
	`slack_enterprise_id` text,
	`slack_enterprise_name` text,
	`slack_app_id` text NOT NULL,
	`slack_bot_user_id` text NOT NULL,
	`bot_access_token_ciphertext` text NOT NULL,
	`granted_scopes_json` text NOT NULL,
	`installed_by_slack_user_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`disabled_at_ms` integer,
	CONSTRAINT "openMeldDaemon_slack_installations_installation_id_non_empty_check" CHECK(length(trim("installation_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_status_check" CHECK("installation_status" in ('active', 'disabled')),
	CONSTRAINT "openMeldDaemon_slack_installations_owner_user_id_non_empty_check" CHECK(length(trim("owner_user_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_assistant_profile_id_non_empty_check" CHECK(length(trim("assistant_profile_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_space_id_non_empty_check" CHECK(length(trim("space_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_space_url_non_empty_check" CHECK(length(trim("space_url")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_slack_team_id_non_empty_check" CHECK(length(trim("slack_team_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_slack_team_name_non_empty_check" CHECK("slack_team_name" is null or length(trim("slack_team_name")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_slack_enterprise_id_non_empty_check" CHECK("slack_enterprise_id" is null or length(trim("slack_enterprise_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_slack_enterprise_name_non_empty_check" CHECK("slack_enterprise_name" is null or length(trim("slack_enterprise_name")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_slack_app_id_non_empty_check" CHECK(length(trim("slack_app_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_slack_bot_user_id_non_empty_check" CHECK(length(trim("slack_bot_user_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_bot_access_token_ciphertext_non_empty_check" CHECK(length(trim("bot_access_token_ciphertext")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_granted_scopes_json_non_empty_check" CHECK(length(trim("granted_scopes_json")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_installed_by_slack_user_id_non_empty_check" CHECK("installed_by_slack_user_id" is null or length(trim("installed_by_slack_user_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_created_at_positive_check" CHECK("created_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms"),
	CONSTRAINT "openMeldDaemon_slack_installations_disabled_at_positive_check" CHECK("disabled_at_ms" is null or "disabled_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_slack_installations_lifecycle_check" CHECK((("installation_status" = 'active' and "disabled_at_ms" is null) or ("installation_status" = 'disabled' and "disabled_at_ms" is not null)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_openMeldDaemon_slack_installations_active_team` ON `openMeldDaemon_slack_installations` (`slack_team_id`) WHERE "installation_status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_openMeldDaemon_slack_installations_active_bootstrap` ON `openMeldDaemon_slack_installations` (`owner_user_id`,`assistant_profile_id`,`space_id`) WHERE "installation_status" = 'active';--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_slack_installations_owner_status` ON `openMeldDaemon_slack_installations` (`owner_user_id`,`installation_status`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_slack_installations_space_status` ON `openMeldDaemon_slack_installations` (`space_id`,`installation_status`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_slack_installations_assistant_status` ON `openMeldDaemon_slack_installations` (`assistant_profile_id`,`installation_status`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_slack_oauth_states` (
	`state_digest` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`assistant_profile_id` text NOT NULL,
	`space_id` text NOT NULL,
	`space_url` text NOT NULL,
	`requested_by_profile_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`consumed_at_ms` integer,
	CONSTRAINT "openMeldDaemon_slack_oauth_states_state_digest_non_empty_check" CHECK(length(trim("state_digest")) > 0),
	CONSTRAINT "openMeldDaemon_slack_oauth_states_owner_user_id_non_empty_check" CHECK(length(trim("owner_user_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_oauth_states_assistant_profile_id_non_empty_check" CHECK(length(trim("assistant_profile_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_oauth_states_space_id_non_empty_check" CHECK(length(trim("space_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_oauth_states_space_url_non_empty_check" CHECK(length(trim("space_url")) > 0),
	CONSTRAINT "openMeldDaemon_slack_oauth_states_requested_by_profile_id_non_empty_check" CHECK(length(trim("requested_by_profile_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_oauth_states_created_at_positive_check" CHECK("created_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_slack_oauth_states_expires_after_created_check" CHECK("expires_at_ms" > "created_at_ms"),
	CONSTRAINT "openMeldDaemon_slack_oauth_states_consumed_at_valid_check" CHECK("consumed_at_ms" is null or "consumed_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_slack_oauth_states_owner_expires` ON `openMeldDaemon_slack_oauth_states` (`owner_user_id`,"expires_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_slack_oauth_states_expires` ON `openMeldDaemon_slack_oauth_states` ("expires_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_slack_thread_links` (
	`link_id` text PRIMARY KEY NOT NULL,
	`installation_id` text NOT NULL,
	`slack_team_id` text NOT NULL,
	`slack_channel_id` text NOT NULL,
	`slack_thread_ts` text NOT NULL,
	`slack_event_id` text NOT NULL,
	`space_id` text NOT NULL,
	`assistant_profile_id` text NOT NULL,
	`source_client_message_id` text NOT NULL,
	`source_signal_id` text NOT NULL,
	`last_mirrored_signal_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldDaemon_slack_thread_links_link_id_non_empty_check" CHECK(length(trim("link_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_installation_id_non_empty_check" CHECK(length(trim("installation_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_slack_team_id_non_empty_check" CHECK(length(trim("slack_team_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_slack_channel_id_non_empty_check" CHECK(length(trim("slack_channel_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_slack_thread_ts_non_empty_check" CHECK(length(trim("slack_thread_ts")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_slack_event_id_non_empty_check" CHECK(length(trim("slack_event_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_space_id_non_empty_check" CHECK(length(trim("space_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_assistant_profile_id_non_empty_check" CHECK(length(trim("assistant_profile_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_source_client_message_id_non_empty_check" CHECK(length(trim("source_client_message_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_source_signal_id_non_empty_check" CHECK(length(trim("source_signal_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_last_mirrored_signal_id_non_empty_check" CHECK("last_mirrored_signal_id" is null or length(trim("last_mirrored_signal_id")) > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_created_at_positive_check" CHECK("created_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_slack_thread_links_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_openMeldDaemon_slack_thread_links_slack_thread` ON `openMeldDaemon_slack_thread_links` (`slack_team_id`,`slack_channel_id`,`slack_thread_ts`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_openMeldDaemon_slack_thread_links_slack_event` ON `openMeldDaemon_slack_thread_links` (`slack_event_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_slack_thread_links_space_source` ON `openMeldDaemon_slack_thread_links` (`space_id`,`source_signal_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_slack_thread_links_client_message` ON `openMeldDaemon_slack_thread_links` (`source_client_message_id`);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_space_diagnostic_report_wake_pointers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diagnostic_report_id` text NOT NULL,
	`space_id` text NOT NULL,
	`client_message_id` text NOT NULL,
	`source_signal_id` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_space_diagnostic_report_wake_pointer_unique` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`diagnostic_report_id`,`client_message_id`,`source_signal_id`,`target_profile_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_report` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`diagnostic_report_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_client` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`space_id`,`client_message_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_target` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`space_id`,`target_profile_id`,"created_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldDaemon_space_diagnostic_reports` (
	`diagnostic_report_id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`reported_signal_id` text NOT NULL,
	`reply_to_signal_id` text,
	`thread_id` text,
	`problem_type` text NOT NULL,
	`reporter_profile_id` text NOT NULL,
	`wake_pointer_derivation_status` text NOT NULL,
	`reason_codes_json` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_reports_space_created` ON `openMeldDaemon_space_diagnostic_reports` (`space_id`,"created_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_reports_reported_signal` ON `openMeldDaemon_space_diagnostic_reports` (`space_id`,`reported_signal_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_reports_reporter_created` ON `openMeldDaemon_space_diagnostic_reports` (`reporter_profile_id`,"created_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openmeld_profile_space_history` (
	`profile_id` text NOT NULL,
	`gateway_host` text NOT NULL,
	`space_id` text NOT NULL,
	`space_name` text,
	`creator_profile_id` text,
	`creator_kind` text,
	`space_created_at` integer,
	`space_updated_at` integer,
	`last_joined_at` integer NOT NULL,
	`last_seen_ts` integer,
	`pinned_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "openmeld_profile_space_history_status_check" CHECK("status" in ('active', 'removed', 'inaccessible')),
	CONSTRAINT "openmeld_profile_space_history_creator_kind_check" CHECK("creator_kind" is null or "creator_kind" in ('human', 'agent', 'system')),
	CONSTRAINT "openmeld_profile_space_history_last_seen_ts_check" CHECK("last_seen_ts" is null or "last_seen_ts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profile_space_history_profile_gateway_space_uq_idx` ON `openmeld_profile_space_history` (`profile_id`,`gateway_host`,`space_id`);--> statement-breakpoint
CREATE INDEX `openmeld_profile_space_history_profile_gateway_status_joined_idx` ON `openmeld_profile_space_history` (`profile_id`,`gateway_host`,`status`,`last_joined_at`);--> statement-breakpoint
CREATE INDEX `openmeld_profile_space_history_profile_gateway_status_pinned_idx` ON `openmeld_profile_space_history` (`profile_id`,`gateway_host`,`status`,`pinned_at`);--> statement-breakpoint
CREATE INDEX `openmeld_profile_space_history_profile_gateway_updated_idx` ON `openmeld_profile_space_history` (`profile_id`,`gateway_host`,`updated_at`);--> statement-breakpoint
CREATE TABLE `openmeld_profiles` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`profile_name` text NOT NULL,
	`profile_handle` text NOT NULL,
	`profile_kind` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_by_user_id` text,
	`creator_profile_id` text,
	`source` text NOT NULL,
	`managed_role` text,
	`last_used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "openmeld_profiles_profile_kind_check" CHECK("profile_kind" in ('human', 'agent', 'system')),
	CONSTRAINT "openmeld_profiles_status_check" CHECK("status" in ('active', 'disabled')),
	CONSTRAINT "openmeld_profiles_source_check" CHECK("source" in ('auth_bootstrap', 'cli_create', 'migration')),
	CONSTRAINT "openmeld_profiles_managed_role_check" CHECK("managed_role" is null or ("profile_kind" = 'agent' and "managed_role" in ('openmeld_assistant'))),
	CONSTRAINT "openmeld_profiles_default_profile_check" CHECK("is_default" = 0 or "profile_kind" = 'human'),
	CONSTRAINT "openmeld_profiles_profile_handle_check" CHECK(length(trim("profile_handle")) > 0 and "profile_handle" not glob '*[^A-Za-z0-9._-]*' and substr(trim("profile_handle"), 1, 1) glob '[A-Za-z0-9]' and length(trim("profile_handle")) <= 128),
	CONSTRAINT "openmeld_profiles_profile_id_format_check" CHECK(( ("profile_kind" = 'agent' and length("profile_id") = 40 and substr("profile_id", 1, 4) = 'agt_' and length(substr("profile_id", 5)) = 36 and substr("profile_id", 5) not glob '*[^0-9a-f-]*' and length(replace(substr("profile_id", 5), '-', '')) = 32 and substr(substr("profile_id", 5), 9, 1) = '-' and substr(substr("profile_id", 5), 14, 1) = '-' and substr(substr("profile_id", 5), 19, 1) = '-' and substr(substr("profile_id", 5), 24, 1) = '-') or ("profile_kind" in ('human', 'system') and length("profile_id") = 36 and "profile_id" not glob '*[^0-9a-f-]*' and length(replace("profile_id", '-', '')) = 32 and substr("profile_id", 9, 1) = '-' and substr("profile_id", 14, 1) = '-' and substr("profile_id", 19, 1) = '-' and substr("profile_id", 24, 1) = '-') ))
);
--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_user_id_idx` ON `openmeld_profiles` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_kind_idx` ON `openmeld_profiles` (`owner_user_id`,`profile_kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_handle_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`profile_handle`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_default_idx` ON `openmeld_profiles` (`owner_user_id`,`is_default`);--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_default_human_uq_idx` ON `openmeld_profiles` (`owner_user_id`) WHERE "profile_kind" = 'human' and "is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_managed_role_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`managed_role`) WHERE "managed_role" is not null and "status" = 'active';--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_status_idx` ON `openmeld_profiles` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `openmeld_space_deletion_tombstones` (
	`gateway_host` text NOT NULL,
	`space_id` text NOT NULL,
	`space_name` text,
	`creator_profile_id` text,
	`creator_kind` text,
	`deleted_by_profile_id` text,
	`deleted_by_profile_name` text,
	`deleted_by_owner_user_id` text,
	`deleted_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "openmeld_space_deletion_tombstones_creator_kind_check" CHECK("creator_kind" is null or "creator_kind" in ('human', 'agent', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_space_deletion_tombstones_gateway_space_uq_idx` ON `openmeld_space_deletion_tombstones` (`gateway_host`,`space_id`);--> statement-breakpoint
CREATE INDEX `openmeld_space_deletion_tombstones_gateway_deleted_idx` ON `openmeld_space_deletion_tombstones` (`gateway_host`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `openmeld_waitlist_emails` (
	`email` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
