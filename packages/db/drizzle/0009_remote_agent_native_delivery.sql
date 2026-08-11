CREATE TABLE `openMeldRemoteAgent_native_delivery_ledger` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`space_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`trigger_message_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`attempt_id` text,
	`idempotency_key` text NOT NULL,
	`submission_id` text,
	`worker_request_id` text,
	`status` text NOT NULL,
	`failure_code` text,
	`on_behalf_of_profile_id` text,
	`on_behalf_of_user_id` text,
	`on_behalf_of_display_name` text,
	`published_signal_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`submitted_at_ms` integer,
	`accepted_at_ms` integer,
	`callback_received_at_ms` integer,
	`completed_at_ms` integer,
	CONSTRAINT "openMeldRemoteAgent_native_delivery_status_check" CHECK("status" in ('guardrail_rejected', 'flag_rejected', 'worker_unavailable', 'submitted', 'accepted', 'retry_observed', 'completed', 'callback_rejected', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_native_delivery_idempotency_key_unique` ON `openMeldRemoteAgent_native_delivery_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_native_delivery_submission_id_unique` ON `openMeldRemoteAgent_native_delivery_ledger` (`submission_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_native_delivery_space_trigger` ON `openMeldRemoteAgent_native_delivery_ledger` (`space_id`,`trigger_message_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_native_delivery_status_updated` ON `openMeldRemoteAgent_native_delivery_ledger` (`status`,"updated_at_ms" desc);--> statement-breakpoint
CREATE TABLE `openMeldRemoteAgent_org_guardrails` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`breaker_status` text DEFAULT 'ok' NOT NULL,
	`resting_until_ms` integer,
	`daily_budget_cents` integer DEFAULT 5000 NOT NULL,
	`failure_code` text,
	`manually_tripped_by` text,
	`manually_tripped_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldRemoteAgent_org_guardrails_status_check" CHECK("breaker_status" in ('ok', 'resting_until_tomorrow', 'faulted')),
	CONSTRAINT "openMeldRemoteAgent_org_guardrails_budget_positive_check" CHECK("daily_budget_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_org_guardrails_status` ON `openMeldRemoteAgent_org_guardrails` (`breaker_status`,`resting_until_ms`);--> statement-breakpoint
ALTER TABLE `openMeldDaemon_agent_profile_bindings` ADD COLUMN `runtime_kind` text DEFAULT 'openmeld_service' NOT NULL;--> statement-breakpoint
ALTER TABLE `openMeldDaemon_agent_profile_bindings` ADD COLUMN `hosted_runtime_identity_json` text;--> statement-breakpoint
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_runtime_kind_insert_check`
BEFORE INSERT ON `openMeldDaemon_agent_profile_bindings`
WHEN NEW.runtime_kind NOT IN ('openmeld_service', 'hosted_center_agent')
BEGIN
	SELECT RAISE(ABORT, 'openMeldDaemon_agent_profile_bindings_runtime_kind_check');
END;--> statement-breakpoint
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_runtime_kind_update_check`
BEFORE UPDATE ON `openMeldDaemon_agent_profile_bindings`
WHEN NEW.runtime_kind NOT IN ('openmeld_service', 'hosted_center_agent')
BEGIN
	SELECT RAISE(ABORT, 'openMeldDaemon_agent_profile_bindings_runtime_kind_check');
END;--> statement-breakpoint
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_hosted_identity_insert_check`
BEFORE INSERT ON `openMeldDaemon_agent_profile_bindings`
WHEN NOT (
	(NEW.runtime_kind = 'openmeld_service' AND NEW.hosted_runtime_identity_json IS NULL)
	OR (
		NEW.runtime_kind = 'hosted_center_agent'
		AND NEW.hosted_runtime_identity_json IS NOT NULL
		AND json_valid(NEW.hosted_runtime_identity_json)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'openMeldDaemon_agent_profile_bindings_hosted_identity_check');
END;--> statement-breakpoint
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_hosted_identity_update_check`
BEFORE UPDATE ON `openMeldDaemon_agent_profile_bindings`
WHEN NOT (
	(NEW.runtime_kind = 'openmeld_service' AND NEW.hosted_runtime_identity_json IS NULL)
	OR (
		NEW.runtime_kind = 'hosted_center_agent'
		AND NEW.hosted_runtime_identity_json IS NOT NULL
		AND json_valid(NEW.hosted_runtime_identity_json)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'openMeldDaemon_agent_profile_bindings_hosted_identity_check');
END;
