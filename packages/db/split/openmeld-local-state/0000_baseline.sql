-- openmeld-local-state baseline 0000 (faithful DDL from the frozen source schema, 2026-06-13)
-- 14 tables; CDT and retired start_* tables omitted. Do not hand-edit.
CREATE TABLE `openMeldDaemon_agent_profile_bindings` (
	`binding_id` text PRIMARY KEY NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	"openmeld_service_runtime_id" text NOT NULL,
	"agent_controller_ref" text NOT NULL,
	`binding_state` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`disabled_at_ms` integer,
	`created_by_profile_id` text,
	`reason_code` text, `agent_controller_conversation_id` text,
	`model_id` text,
	`reasoning_level` text,
	`agent_controller_collaboration_mode` text,
	`agent_controller_permission_mode` text,
	`opencode_permission` text,
	"runtime_kind" text DEFAULT 'openmeld_service' NOT NULL,
	"hosted_runtime_identity_json" text,
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_binding_id_non_empty_check" CHECK(length(trim("binding_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_owner_kind_check" CHECK("owner_kind" in ('owner_account')),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_owner_id_non_empty_check" CHECK(length(trim("owner_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_agent_profile_id_non_empty_check" CHECK(length(trim("agent_profile_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_runtime_id_non_empty_check" CHECK(length(trim("openmeld_service_runtime_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_capability_ref_non_empty_check" CHECK(length(trim("agent_controller_ref")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_state_check" CHECK("binding_state" in ('enabled_primary', 'disabled_historical')),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_created_at_positive_check" CHECK("created_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms"),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_disabled_at_positive_check" CHECK("disabled_at_ms" is null or "disabled_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_lifecycle_check" CHECK((("binding_state" = 'enabled_primary' and "disabled_at_ms" is null) or ("binding_state" = 'disabled_historical' and "disabled_at_ms" is not null))),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_created_by_non_empty_check" CHECK("created_by_profile_id" is null or length(trim("created_by_profile_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_reason_code_check" CHECK("reason_code" is null or (length(trim("reason_code")) > 0 and length("reason_code") <= 160)),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_runtime_kind_check" CHECK("runtime_kind" in ('openmeld_service', 'hosted_center_agent')),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_hosted_identity_check" CHECK((("runtime_kind" = 'openmeld_service' and "hosted_runtime_identity_json" is null) or ("runtime_kind" = 'hosted_center_agent' and "hosted_runtime_identity_json" is not null and json_valid("hosted_runtime_identity_json"))))
);
CREATE TABLE "openMeldDaemon_owned_devices" (
	`owner_user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`observed_display_name` text,
	`user_display_name` text,
	`platform_family` text,
	`os_version` text,
	`device_type` text,
	`first_seen_at_ms` integer NOT NULL,
	`last_observed_at_ms` integer,
	`updated_at_ms` integer NOT NULL
, `connected_computer_id` text);
CREATE TABLE `openMeldDaemon_connected_computers` (
  `owner_user_id` text NOT NULL,
  `connected_computer_id` text NOT NULL,
  `created_at_ms` integer NOT NULL,
  `updated_at_ms` integer NOT NULL
);
CREATE TABLE `openMeldDaemon_forgotten_devices` (
	`owner_user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`forgotten_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
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
CREATE TABLE `openMeldDaemon_prepare_session_tokens` (
	`token_digest` text PRIMARY KEY NOT NULL,
	`prepare_session_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`issued_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`revoked_at_ms` integer
);
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
CREATE TABLE `openMeldDaemon_runtime_registry_records` (
	"openmeld_service_runtime_id" text PRIMARY KEY NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`device_id` text NOT NULL,
	`lane` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`last_registered_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldDaemon_runtime_registry_records_owner_kind_check" CHECK("owner_kind" in ('owner_account')),
	CONSTRAINT "openMeldDaemon_runtime_registry_records_runtime_id_non_empty_check" CHECK(length(trim("openmeld_service_runtime_id")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_registry_records_owner_id_non_empty_check" CHECK(length(trim("owner_id")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_registry_records_device_id_non_empty_check" CHECK(length(trim("device_id")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_registry_records_lane_non_empty_check" CHECK(length(trim("lane")) > 0)
);
CREATE TABLE "openMeldDaemon_runtime_agent_controller_reports" (
	"openmeld_service_runtime_id" text NOT NULL,
	"agent_controller_ref" text NOT NULL,
	`report_status` text NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`reported_reason_codes_json` text NOT NULL,
	`agent_controller_interface_json` text,
	`accepted_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_runtime_id_non_empty_check" CHECK(length(trim("openmeld_service_runtime_id")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_agent_controller_ref_non_empty_check" CHECK(length(trim("agent_controller_ref")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_status_check" CHECK("report_status" in ('ready', 'disabled', 'unavailable', 'unknown')),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_observed_at_positive_check" CHECK("observed_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_expires_after_observed_check" CHECK("expires_at_ms" > "observed_at_ms"),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_accepted_at_positive_check" CHECK("accepted_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_runtime_agent_controller_reports_updated_at_positive_check" CHECK("updated_at_ms" > 0)
);
CREATE TABLE `openMeldDaemon_provider_access_evidence` (
	`evidence_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`binding_id` text NOT NULL,
	"openmeld_service_runtime_id" text NOT NULL,
	"agent_controller_ref" text NOT NULL,
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
CREATE TABLE `openMeldDaemon_agent_execution_readiness_impacts` (
	`impact_id` text PRIMARY KEY NOT NULL,
	`impact_kind` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`binding_id` text NOT NULL,
	"openmeld_service_runtime_id" text NOT NULL,
	"agent_controller_ref" text NOT NULL,
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
CREATE TABLE `openMeldDaemon_space_diagnostic_report_wake_pointers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diagnostic_report_id` text NOT NULL,
	`space_id` text NOT NULL,
	`client_message_id` text,
	`source_signal_id` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
CREATE UNIQUE INDEX `openMeldDaemon_agent_profile_bindings_enabled_primary_unique` ON `openMeldDaemon_agent_profile_bindings` (`owner_kind`,`owner_id`,`agent_profile_id`) WHERE "binding_state" = 'enabled_primary';
CREATE INDEX `idx_openMeldDaemon_agent_profile_bindings_openmeld_service_runtime_agent_controller` ON `openMeldDaemon_agent_profile_bindings` (`openmeld_service_runtime_id`,`agent_controller_ref`);
CREATE INDEX `idx_openMeldDaemon_agent_profile_bindings_owner_profile_state` ON `openMeldDaemon_agent_profile_bindings` (`owner_kind`,`owner_id`,`agent_profile_id`,`binding_state`);
CREATE UNIQUE INDEX `openMeldDaemon_owned_devices_owner_device_unique` ON `openMeldDaemon_owned_devices` (`owner_user_id`,`device_id`);
CREATE INDEX `idx_openMeldDaemon_owned_devices_owner_connected_computer` ON `openMeldDaemon_owned_devices` (`owner_user_id`,`connected_computer_id`);
CREATE UNIQUE INDEX `openMeldDaemon_connected_computers_owner_computer_unique` ON `openMeldDaemon_connected_computers` (`owner_user_id`,`connected_computer_id`);
CREATE UNIQUE INDEX `openMeldDaemon_forgotten_devices_owner_device_unique` ON `openMeldDaemon_forgotten_devices` (`owner_user_id`,`device_id`);
CREATE INDEX `idx_openMeldDaemon_prepare_sessions_device_status_updated` ON `openMeldDaemon_prepare_sessions` (`owner_user_id`,`device_id`,`lifecycle_status`,"updated_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_prepare_sessions_expires` ON `openMeldDaemon_prepare_sessions` (`expires_at_ms`);
CREATE INDEX `idx_openMeldDaemon_prepare_sessions_owner_status_updated` ON `openMeldDaemon_prepare_sessions` (`owner_user_id`,`lifecycle_status`,"updated_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_prepare_session_tokens_owner_issued` ON `openMeldDaemon_prepare_session_tokens` (`owner_user_id`,"issued_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_prepare_session_tokens_session_active` ON `openMeldDaemon_prepare_session_tokens` (`prepare_session_id`,`revoked_at_ms`);
CREATE INDEX `idx_openMeldDaemon_prepare_session_events_owner_created` ON `openMeldDaemon_prepare_session_events` (`owner_user_id`,"created_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_prepare_session_events_session_created` ON `openMeldDaemon_prepare_session_events` (`prepare_session_id`,`created_at_ms`);
CREATE UNIQUE INDEX `openMeldDaemon_runtime_registry_records_owner_device_lane_unique` ON `openMeldDaemon_runtime_registry_records` (`owner_kind`,`owner_id`,`device_id`,`lane`);
CREATE UNIQUE INDEX `openMeldDaemon_runtime_agent_controller_reports_runtime_agent_controller_unique` ON `openMeldDaemon_runtime_agent_controller_reports` (`openmeld_service_runtime_id`,`agent_controller_ref`);
CREATE INDEX `idx_openMeldDaemon_runtime_agent_controller_reports_agent_controller_status_expires` ON `openMeldDaemon_runtime_agent_controller_reports` (`agent_controller_ref`,`report_status`,`expires_at_ms`);
CREATE INDEX `idx_openMeldDaemon_runtime_agent_controller_reports_runtime_expires` ON `openMeldDaemon_runtime_agent_controller_reports` (`openmeld_service_runtime_id`,`expires_at_ms`);
CREATE UNIQUE INDEX `openMeldDaemon_provider_access_evidence_execution_provider_unique` ON `openMeldDaemon_provider_access_evidence` (`agent_profile_id`,`binding_id`,"openmeld_service_runtime_id","agent_controller_ref",`provider`);
CREATE INDEX `idx_openMeldDaemon_provider_access_evidence_observed` ON `openMeldDaemon_provider_access_evidence` (`provider`,"observed_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_provider_access_evidence_readiness` ON `openMeldDaemon_provider_access_evidence` (`agent_profile_id`,`binding_id`,"openmeld_service_runtime_id","agent_controller_ref",`expires_at_ms`);
CREATE INDEX `idx_openMeldDaemon_provider_access_evidence_source_dispatch` ON `openMeldDaemon_provider_access_evidence` (`source_dispatch_id`,`source_attempt_id`);
CREATE UNIQUE INDEX `openMeldDaemon_provider_conversation_proofs_target_method_unique` ON `openMeldDaemon_provider_conversation_proofs` (`agent_profile_id`,`binding_id`,`openmeld_service_runtime_id`,`agent_controller_ref`,`agent_controller_conversation_id`,`provider`,`method`);
CREATE INDEX `idx_openMeldDaemon_provider_conversation_proofs_observed` ON `openMeldDaemon_provider_conversation_proofs` (`provider`,`method`,"observed_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_provider_conversation_proofs_readiness` ON `openMeldDaemon_provider_conversation_proofs` (`agent_profile_id`,`binding_id`,`openmeld_service_runtime_id`,`agent_controller_ref`,`agent_controller_conversation_id`,`expires_at_ms`);
CREATE UNIQUE INDEX `openMeldDaemon_agent_execution_readiness_impacts_target_kind_unique` ON `openMeldDaemon_agent_execution_readiness_impacts` (`agent_profile_id`,`binding_id`,"openmeld_service_runtime_id","agent_controller_ref",`impact_kind`);
CREATE INDEX `idx_openMeldDaemon_agent_execution_readiness_impacts_observed` ON `openMeldDaemon_agent_execution_readiness_impacts` (`impact_kind`,"observed_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_agent_execution_readiness_impacts_readiness` ON `openMeldDaemon_agent_execution_readiness_impacts` (`agent_profile_id`,`binding_id`,"openmeld_service_runtime_id","agent_controller_ref",`expires_at_ms`);
CREATE INDEX `idx_openMeldDaemon_agent_execution_readiness_impacts_source_dispatch` ON `openMeldDaemon_agent_execution_readiness_impacts` (`source_dispatch_id`,`source_attempt_id`);
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_reports_reported_signal` ON `openMeldDaemon_space_diagnostic_reports` (`space_id`,`reported_signal_id`);
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_reports_reporter_created` ON `openMeldDaemon_space_diagnostic_reports` (`reporter_profile_id`,"created_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_reports_space_created` ON `openMeldDaemon_space_diagnostic_reports` (`space_id`,"created_at_ms" desc);
CREATE UNIQUE INDEX `openMeldDaemon_space_diagnostic_report_wake_pointer_unique` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`diagnostic_report_id`,`source_signal_id`,`target_profile_id`);
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_client` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`space_id`,`client_message_id`);
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_report` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`diagnostic_report_id`);
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_target` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`space_id`,`target_profile_id`,"created_at_ms" desc);
