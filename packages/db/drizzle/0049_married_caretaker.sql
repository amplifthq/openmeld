CREATE TABLE `agent_delegation_children` (
	`delegation_id` text NOT NULL,
	`child_index` integer NOT NULL,
	`task_key` text NOT NULL,
	`task_handle_json` text NOT NULL,
	`role` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`state` text NOT NULL,
	`terminal_outcome_json` text,
	`activated_at_ms` integer,
	`terminal_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`delegation_id`, `child_index`),
	CONSTRAINT "agent_delegation_children_index_nonnegative_check" CHECK("child_index" >= 0),
	CONSTRAINT "agent_delegation_children_task_non_empty_check" CHECK(length(trim("task_key")) > 0 and length(trim("task_handle_json")) > 0),
	CONSTRAINT "agent_delegation_children_role_check" CHECK("role" in ('primary', 'fallback')),
	CONSTRAINT "agent_delegation_children_profile_non_empty_check" CHECK(length(trim("agent_profile_id")) > 0),
	CONSTRAINT "agent_delegation_children_state_check" CHECK("state" in ('planned', 'active', 'terminal', 'skipped', 'cancelled')),
	CONSTRAINT "agent_delegation_children_times_check" CHECK("created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("activated_at_ms" is null or "activated_at_ms" >= "created_at_ms") and ("terminal_at_ms" is null or "terminal_at_ms" >= "created_at_ms"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_delegation_children_task_unique` ON `agent_delegation_children` (`task_key`);--> statement-breakpoint
CREATE INDEX `agent_delegation_children_delegation_state_idx` ON `agent_delegation_children` (`delegation_id`,`state`);--> statement-breakpoint
CREATE TABLE `agent_delegations` (
	`delegation_id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`organization_id` text NOT NULL,
	`space_id` text NOT NULL,
	`parent_task_key` text NOT NULL,
	`parent_task_handle_json` text NOT NULL,
	`completion_policy_json` text NOT NULL,
	`state` text NOT NULL,
	`generation` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	CONSTRAINT "agent_delegations_identity_non_empty_check" CHECK(length(trim("delegation_id")) > 0 and length(trim("idempotency_key")) > 0),
	CONSTRAINT "agent_delegations_scope_non_empty_check" CHECK(length(trim("organization_id")) > 0 and length(trim("space_id")) > 0),
	CONSTRAINT "agent_delegations_parent_non_empty_check" CHECK(length(trim("parent_task_key")) > 0 and length(trim("parent_task_handle_json")) > 0),
	CONSTRAINT "agent_delegations_policy_non_empty_check" CHECK(length(trim("completion_policy_json")) > 0),
	CONSTRAINT "agent_delegations_state_check" CHECK("state" in ('active', 'completed', 'cancelled', 'failed')),
	CONSTRAINT "agent_delegations_generation_positive_check" CHECK("generation" > 0),
	CONSTRAINT "agent_delegations_times_check" CHECK("created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("completed_at_ms" is null or "completed_at_ms" >= "created_at_ms"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_delegations_idempotency_unique` ON `agent_delegations` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_delegations_parent_state_idx` ON `agent_delegations` (`parent_task_key`,`state`);--> statement-breakpoint
CREATE INDEX `agent_delegations_org_state_updated_idx` ON `agent_delegations` (`organization_id`,`state`,"updated_at_ms" desc);--> statement-breakpoint
CREATE TABLE `agent_task_completion_subscriptions` (
	`subscription_id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`organization_id` text NOT NULL,
	`watched_task_key` text NOT NULL,
	`watched_task_handle_json` text NOT NULL,
	`observer_task_key` text NOT NULL,
	`observer_task_handle_json` text NOT NULL,
	`completion_condition` text NOT NULL,
	`continuation_json` text,
	`continuation_idempotency_key` text,
	`state` text NOT NULL,
	`outcome_json` text,
	`last_event_id` text,
	`claim_id` text,
	`claim_expires_at_ms` integer,
	`continuation_task_key` text,
	`continuation_task_handle_json` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`settled_at_ms` integer,
	CONSTRAINT "agent_task_completion_subscriptions_idempotency_non_empty_check" CHECK(length(trim("idempotency_key")) > 0),
	CONSTRAINT "agent_task_completion_subscriptions_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "agent_task_completion_subscriptions_watched_non_empty_check" CHECK(length(trim("watched_task_key")) > 0 and length(trim("watched_task_handle_json")) > 0),
	CONSTRAINT "agent_task_completion_subscriptions_observer_non_empty_check" CHECK(length(trim("observer_task_key")) > 0 and length(trim("observer_task_handle_json")) > 0),
	CONSTRAINT "agent_task_completion_subscriptions_condition_check" CHECK("completion_condition" in ('terminal', 'succeeded', 'failed', 'needs_attention')),
	CONSTRAINT "agent_task_completion_subscriptions_continuation_shape_check" CHECK((
        ("continuation_json" is null and "continuation_idempotency_key" is null)
        or ("continuation_json" is not null and "continuation_idempotency_key" is not null and length(trim("continuation_idempotency_key")) > 0)
      )),
	CONSTRAINT "agent_task_completion_subscriptions_state_check" CHECK("state" in ('pending', 'ready', 'continuation_claimed', 'settled', 'cancelled')),
	CONSTRAINT "agent_task_completion_subscriptions_claim_shape_check" CHECK((
        ("state" = 'continuation_claimed' and "claim_id" is not null and "claim_expires_at_ms" is not null)
        or ("state" <> 'continuation_claimed' and "claim_id" is null and "claim_expires_at_ms" is null)
      )),
	CONSTRAINT "agent_task_completion_subscriptions_continuation_task_shape_check" CHECK((
        ("continuation_task_key" is null and "continuation_task_handle_json" is null)
        or ("continuation_task_key" is not null and "continuation_task_handle_json" is not null)
      )),
	CONSTRAINT "agent_task_completion_subscriptions_times_check" CHECK("created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("settled_at_ms" is null or "settled_at_ms" >= "created_at_ms"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_task_completion_subscriptions_idempotency_unique` ON `agent_task_completion_subscriptions` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_task_completion_subscriptions_continuation_idempotency_unique` ON `agent_task_completion_subscriptions` (`continuation_idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_task_completion_subscriptions_watched_state_idx` ON `agent_task_completion_subscriptions` (`watched_task_key`,`state`);--> statement-breakpoint
CREATE INDEX `agent_task_completion_subscriptions_state_updated_idx` ON `agent_task_completion_subscriptions` (`state`,`updated_at_ms`);--> statement-breakpoint
CREATE INDEX `agent_task_completion_subscriptions_observer_idx` ON `agent_task_completion_subscriptions` (`observer_task_key`,"created_at_ms" desc);--> statement-breakpoint
CREATE TABLE `agent_task_terminal_outcomes` (
	`task_key` text PRIMARY KEY NOT NULL,
	`task_handle_json` text NOT NULL,
	`status` text NOT NULL,
	`event_id` text NOT NULL,
	`outcome_json` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	`observed_at_ms` integer NOT NULL,
	CONSTRAINT "agent_task_terminal_outcomes_task_key_non_empty_check" CHECK(length(trim("task_key")) > 0),
	CONSTRAINT "agent_task_terminal_outcomes_handle_non_empty_check" CHECK(length(trim("task_handle_json")) > 0),
	CONSTRAINT "agent_task_terminal_outcomes_status_check" CHECK("status" in ('succeeded', 'failed', 'stopped', 'stayed_silent', 'publication_failed')),
	CONSTRAINT "agent_task_terminal_outcomes_event_non_empty_check" CHECK(length(trim("event_id")) > 0),
	CONSTRAINT "agent_task_terminal_outcomes_outcome_non_empty_check" CHECK(length(trim("outcome_json")) > 0),
	CONSTRAINT "agent_task_terminal_outcomes_times_check" CHECK("occurred_at_ms" >= 0 and "observed_at_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX `agent_task_terminal_outcomes_event_idx` ON `agent_task_terminal_outcomes` (`event_id`);--> statement-breakpoint
CREATE INDEX `agent_task_terminal_outcomes_status_observed_idx` ON `agent_task_terminal_outcomes` (`status`,"observed_at_ms" desc);