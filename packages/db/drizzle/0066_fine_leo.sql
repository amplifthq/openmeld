CREATE TABLE `openMeldDaemon_pre_head_failure_publication_outbox` (
	`dispatch_id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`attempt_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`model_version` text NOT NULL,
	`failure_context` text NOT NULL,
	`final_status` text NOT NULL,
	`error_code` text NOT NULL,
	`error_message` text,
	`record_profile_not_found_observation` integer DEFAULT false NOT NULL,
	`publication_command_json` text NOT NULL,
	`redrive_message_json` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`next_attempt_at_ms` integer NOT NULL,
	`claim_id` text,
	`claim_expires_at_ms` integer,
	`state_version` integer NOT NULL,
	`completed_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldDaemon_pre_head_failure_publication_outbox_status_check" CHECK("openMeldDaemon_pre_head_failure_publication_outbox"."status" IN ('pending', 'completed')),
	CONSTRAINT "openMeldDaemon_pre_head_failure_publication_outbox_failure_context_check" CHECK("openMeldDaemon_pre_head_failure_publication_outbox"."failure_context" = 'preflight_terminal'),
	CONSTRAINT "openMeldDaemon_pre_head_failure_publication_outbox_final_status_check" CHECK("openMeldDaemon_pre_head_failure_publication_outbox"."final_status" IN ('blocked', 'failed_terminal')),
	CONSTRAINT "openMeldDaemon_pre_head_failure_publication_outbox_counters_check" CHECK("openMeldDaemon_pre_head_failure_publication_outbox"."attempt_count" >= 0 AND "openMeldDaemon_pre_head_failure_publication_outbox"."state_version" >= 0),
	CONSTRAINT "openMeldDaemon_pre_head_failure_publication_outbox_claim_check" CHECK(("openMeldDaemon_pre_head_failure_publication_outbox"."claim_id" IS NULL AND "openMeldDaemon_pre_head_failure_publication_outbox"."claim_expires_at_ms" IS NULL) OR ("openMeldDaemon_pre_head_failure_publication_outbox"."claim_id" IS NOT NULL AND "openMeldDaemon_pre_head_failure_publication_outbox"."claim_expires_at_ms" IS NOT NULL)),
	CONSTRAINT "openMeldDaemon_pre_head_failure_publication_outbox_completion_check" CHECK(("openMeldDaemon_pre_head_failure_publication_outbox"."status" = 'pending' AND "openMeldDaemon_pre_head_failure_publication_outbox"."completed_at_ms" IS NULL) OR ("openMeldDaemon_pre_head_failure_publication_outbox"."status" = 'completed' AND "openMeldDaemon_pre_head_failure_publication_outbox"."completed_at_ms" IS NOT NULL AND "openMeldDaemon_pre_head_failure_publication_outbox"."claim_id" IS NULL AND "openMeldDaemon_pre_head_failure_publication_outbox"."claim_expires_at_ms" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `openMeldDaemon_pre_head_failure_publication_outbox_due_idx` ON `openMeldDaemon_pre_head_failure_publication_outbox` (`status`,`next_attempt_at_ms`,`claim_expires_at_ms`);--> statement-breakpoint
CREATE INDEX `openMeldDaemon_pre_head_failure_publication_outbox_updated_idx` ON `openMeldDaemon_pre_head_failure_publication_outbox` (`updated_at_ms`);