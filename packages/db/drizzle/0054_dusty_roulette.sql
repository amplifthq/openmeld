CREATE TABLE `center_agent_wake_publications` (
	`publication_id` text PRIMARY KEY NOT NULL,
	`delegation_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`space_id` text NOT NULL,
	`command_json` text NOT NULL,
	`state` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`next_attempt_at_ms` integer NOT NULL,
	`last_error` text,
	`claim_id` text,
	`claim_expires_at_ms` integer,
	`accepted_at_ms` integer,
	`signal_json` text,
	`completed_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "center_agent_wake_publications_identity_non_empty_check" CHECK(length(trim("publication_id")) > 0 and length(trim("delegation_id")) > 0),
	CONSTRAINT "center_agent_wake_publications_scope_non_empty_check" CHECK(length(trim("organization_id")) > 0 and length(trim("space_id")) > 0),
	CONSTRAINT "center_agent_wake_publications_command_non_empty_check" CHECK(length(trim("command_json")) > 0),
	CONSTRAINT "center_agent_wake_publications_state_check" CHECK("state" in ('pending', 'accepted', 'completed', 'failed')),
	CONSTRAINT "center_agent_wake_publications_attempt_nonnegative_check" CHECK("attempt_count" >= 0),
	CONSTRAINT "center_agent_wake_publications_times_check" CHECK("next_attempt_at_ms" >= 0 and "created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("claim_expires_at_ms" is null or "claim_expires_at_ms" >= "created_at_ms") and ("accepted_at_ms" is null or "accepted_at_ms" >= "created_at_ms") and ("completed_at_ms" is null or "completed_at_ms" >= "created_at_ms")),
	CONSTRAINT "center_agent_wake_publications_claim_shape_check" CHECK((("claim_id" is null and "claim_expires_at_ms" is null) or (length(trim("claim_id")) > 0 and "claim_expires_at_ms" is not null))),
	CONSTRAINT "center_agent_wake_publications_terminal_shape_check" CHECK((
        ("state" = 'pending' and "accepted_at_ms" is null and "signal_json" is null and "completed_at_ms" is null)
        or ("state" = 'accepted' and "accepted_at_ms" is not null and length(trim("signal_json")) > 0 and "completed_at_ms" is null)
        or ("state" = 'completed' and "accepted_at_ms" is not null and length(trim("signal_json")) > 0 and "completed_at_ms" is not null)
        or ("state" = 'failed' and "completed_at_ms" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_wake_publications_delegation_unique` ON `center_agent_wake_publications` (`delegation_id`);--> statement-breakpoint
CREATE INDEX `center_agent_wake_publications_due_idx` ON `center_agent_wake_publications` (`state`,`next_attempt_at_ms`);--> statement-breakpoint
CREATE INDEX `center_agent_wake_publications_org_updated_idx` ON `center_agent_wake_publications` (`organization_id`,"updated_at_ms" desc);