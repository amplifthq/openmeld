-- openmeld-wake-evidence baseline 0000 (faithful DDL from the frozen source schema, 2026-06-13)
-- 9 tables; CDT and retired start_* tables omitted. Do not hand-edit.
CREATE TABLE "openMeldDaemon_dispatch_ledger" (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idempotency_key` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`space_id` text NOT NULL,
	`source_event_id` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`status` text NOT NULL,
	`first_seen_at_ms` integer NOT NULL,
	`last_attempt_at_ms` integer NOT NULL,
	`attempt_count` integer NOT NULL,
	`latest_attempt_id` text,
	`reply_hint_sent_at_ms` integer,
	`final_reply_sent_at_ms` integer
, `source_client_message_id` text, `dispatch_owner_kind` text, `dispatch_owner_id` text);
CREATE TABLE "openMeldDaemon_dispatch_attempts" (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`dispatch_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`status` text NOT NULL,
	`daemon_session_id` text,
	`connection_generation` integer,
	`lease_epoch` integer,
	`created_at_ms` integer NOT NULL,
	`started_at_ms` integer,
	`finished_at_ms` integer,
	`error_code` text,
	`error_message` text
, `task_id` text, `target_profile_id` text, `execution_identity_model_version` text, `execution_binding_id` text, "execution_openmeld_service_runtime_id" text, "execution_agent_controller_ref" text);
CREATE TABLE openMeldDaemon_dlq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dispatch_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      target_profile_id TEXT NOT NULL,
      error_code TEXT NOT NULL,
      error_message TEXT NULL,
      failed_at_ms INTEGER NOT NULL
    );
CREATE TABLE `openMeldDaemon_dispatch_result_inbox` (
	`result_key` text PRIMARY KEY NOT NULL,
	`dispatch_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`task_id` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`daemon_session_id` text NOT NULL,
	`lease_epoch` integer NOT NULL,
	`submitted_connection_generation` integer NOT NULL,
	`result_payload_json` text NOT NULL,
	`accepted_at_ms` integer NOT NULL,
	`publish_state` text NOT NULL,
	`published_signal_id` text,
	`publication_error_code` text,
	`updated_at_ms` integer NOT NULL
, `runtime_coordinator_execution_id` text, `execution_token_run_id` text, `execution_token_fingerprint` text);
CREATE TABLE "openMeldDaemon_dispatch_results" (
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
CREATE TABLE `openMeldDaemon_runtime_coordinator_executions` (
	`runtime_coordinator_execution_id` text PRIMARY KEY NOT NULL,
	`model_version` text NOT NULL,
	`space_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`source_client_message_id` text,
	"openmeld_service_runtime_id_source" text NOT NULL,
	"openmeld_service_runtime_id" text NOT NULL,
	`binding_id` text NOT NULL,
	"agent_controller_ref" text NOT NULL,
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
CREATE TABLE openMeldDaemon_ops_decisions (
      id TEXT PRIMARY KEY,
      decision_code TEXT NOT NULL,
      decision_payload_json TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      decided_at_ms INTEGER NOT NULL,
      expected_recovery_criteria TEXT NULL,
      source TEXT NOT NULL,
      correlation_id TEXT NULL
    );
CREATE UNIQUE INDEX `openMeldDaemon_dispatch_ledger_idempotency_key_unique` ON `openMeldDaemon_dispatch_ledger` (`idempotency_key`);
CREATE INDEX `idx_openMeldDaemon_dispatch_ledger_dispatch_id` ON `openMeldDaemon_dispatch_ledger` (`dispatch_id`);
CREATE INDEX `idx_openMeldDaemon_dispatch_ledger_space_client_message_target` ON `openMeldDaemon_dispatch_ledger` (`space_id`,`source_client_message_id`,`target_profile_id`);
CREATE INDEX `idx_openMeldDaemon_dispatch_ledger_space_source_target` ON `openMeldDaemon_dispatch_ledger` (`space_id`,`source_event_id`,`target_profile_id`);
CREATE INDEX `idx_openMeldDaemon_dispatch_ledger_status_last_attempt` ON `openMeldDaemon_dispatch_ledger` (`status`,`last_attempt_at_ms`);
CREATE INDEX `idx_openMeldDaemon_dispatch_attempts_dispatch_attempt_no` ON `openMeldDaemon_dispatch_attempts` (`dispatch_id`,`attempt_no` DESC);
CREATE INDEX `idx_openMeldDaemon_dispatch_attempts_status_created` ON `openMeldDaemon_dispatch_attempts` (`status`,`created_at_ms` DESC);
CREATE INDEX idx_openMeldDaemon_dlq_failed_at
    ON openMeldDaemon_dlq (failed_at_ms)
  ;
CREATE INDEX `idx_openMeldDaemon_dispatch_result_inbox_dispatch_attempt` ON `openMeldDaemon_dispatch_result_inbox` (`dispatch_id`,`attempt_id`);
CREATE INDEX `idx_openMeldDaemon_dispatch_result_inbox_publish_state` ON `openMeldDaemon_dispatch_result_inbox` (`publish_state`,`updated_at_ms` DESC);
CREATE INDEX `idx_openMeldDaemon_dispatch_result_inbox_runtime_coordinator` ON `openMeldDaemon_dispatch_result_inbox` (`runtime_coordinator_execution_id`,`execution_token_run_id`);
CREATE UNIQUE INDEX `openMeldDaemon_dispatch_results_dispatch_id_unique` ON `openMeldDaemon_dispatch_results` (`dispatch_id`);
CREATE INDEX `idx_openMeldDaemon_dispatch_results_actor_created` ON `openMeldDaemon_dispatch_results` (`actor_profile_id`,`created_at_ms` DESC);
CREATE INDEX `idx_openMeldDaemon_dispatch_results_space_created` ON `openMeldDaemon_dispatch_results` (`space_id`,`created_at_ms` DESC);
CREATE INDEX `idx_openMeldDaemon_rce_runtime_updated` ON `openMeldDaemon_runtime_coordinator_executions` ("openmeld_service_runtime_id","updated_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_rce_space_client_target` ON `openMeldDaemon_runtime_coordinator_executions` (`space_id`,`source_client_message_id`,`target_profile_id`);
CREATE INDEX `idx_openMeldDaemon_rce_space_dispatch_target` ON `openMeldDaemon_runtime_coordinator_executions` (`space_id`,`dispatch_id`,`target_profile_id`);
CREATE INDEX `idx_openMeldDaemon_rce_status_updated` ON `openMeldDaemon_runtime_coordinator_executions` (`status`,"updated_at_ms" desc);
CREATE UNIQUE INDEX `openMeldDaemon_rce_events_idempotency_unique` ON `openMeldDaemon_runtime_coordinator_execution_events` (`runtime_coordinator_execution_id`,`event_type`,`idempotency_key`);
CREATE INDEX `idx_openMeldDaemon_rce_events_execution_observed` ON `openMeldDaemon_runtime_coordinator_execution_events` (`runtime_coordinator_execution_id`,"observed_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_rce_events_type_observed` ON `openMeldDaemon_runtime_coordinator_execution_events` (`event_type`,"observed_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_rce_diag_reason_observed` ON `openMeldDaemon_runtime_coordinator_creation_diagnostics` (`reason_code`,"observed_at_ms" desc);
CREATE INDEX `idx_openMeldDaemon_rce_diag_space_client_target` ON `openMeldDaemon_runtime_coordinator_creation_diagnostics` (`space_id`,`source_client_message_id`,`target_profile_id`);
CREATE INDEX `idx_openMeldDaemon_rce_diag_space_dispatch_target` ON `openMeldDaemon_runtime_coordinator_creation_diagnostics` (`space_id`,`dispatch_id`,`target_profile_id`);
CREATE INDEX idx_openMeldDaemon_ops_decisions_code_time
    ON openMeldDaemon_ops_decisions (decision_code, decided_at_ms DESC)
  ;
CREATE INDEX `idx_openMeldDaemon_ops_decisions_correlation_code_time` ON `openMeldDaemon_ops_decisions` (`correlation_id`,`decision_code`,"decided_at_ms" desc);
CREATE INDEX idx_openMeldDaemon_ops_decisions_correlation_time
    ON openMeldDaemon_ops_decisions (correlation_id, decided_at_ms DESC)
  ;
CREATE INDEX `idx_openMeldDaemon_ops_decisions_time` ON `openMeldDaemon_ops_decisions` ("decided_at_ms" desc);
CREATE UNIQUE INDEX `uq_openMeldDaemon_ops_decisions_correlation_code` ON `openMeldDaemon_ops_decisions` (`correlation_id`,`decision_code`);
