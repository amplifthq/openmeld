CREATE TABLE `agent_profile_creation_approval_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`new_session_policy` text DEFAULT 'ask_every_time' NOT NULL,
	`existing_session_policy` text DEFAULT 'ask_every_time' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_profile_creation_approval_prefs_policy_check" CHECK("new_session_policy" in ('never_allow', 'ask_every_time', 'automatically_allow') and "existing_session_policy" in ('never_allow', 'ask_every_time', 'automatically_allow'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_creation_approval_prefs_org_user_uq_idx` ON `agent_profile_creation_approval_preferences` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `agent_profile_creation_approval_prefs_user_idx` ON `agent_profile_creation_approval_preferences` (`user_id`);--> statement-breakpoint
CREATE TABLE `agent_profile_creation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requester_user_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`target_owner_user_id` text NOT NULL,
	`source` text NOT NULL,
	`profile_name` text NOT NULL,
	`session_strategy` text NOT NULL,
	`native_session_id` text,
	`requested_space_id` text,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`status_reason` text NOT NULL,
	`created_agent_profile_id` text,
	`decided_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_profile_creation_requests_source_check" CHECK("source" in ('web', 'cli', 'local_agent', 'center_agent')),
	CONSTRAINT "agent_profile_creation_requests_strategy_check" CHECK("session_strategy" in ('new', 'resume', 'fork')),
	CONSTRAINT "agent_profile_creation_requests_session_check" CHECK(("session_strategy" = 'new' and "native_session_id" is null) or ("session_strategy" in ('resume', 'fork') and "native_session_id" is not null and length(trim("native_session_id")) > 0)),
	CONSTRAINT "agent_profile_creation_requests_status_check" CHECK("status" in ('pending', 'approved', 'declined', 'cancelled', 'completed', 'failed')),
	CONSTRAINT "agent_profile_creation_requests_status_reason_check" CHECK("status_reason" in ('approval_required', 'automatically_allowed', 'self_request', 'target_policy_denied', 'target_approved', 'target_declined', 'requester_cancelled', 'profile_created', 'profile_creation_failed')),
	CONSTRAINT "agent_profile_creation_requests_completion_check" CHECK(("status" = 'completed' and "created_agent_profile_id" is not null and "completed_at" is not null) or ("status" != 'completed' and "created_agent_profile_id" is null and "completed_at" is null)),
	CONSTRAINT "agent_profile_creation_requests_required_text_check" CHECK(length(trim("id")) > 0 and length(trim("actor_profile_id")) > 0 and length(trim("profile_name")) > 0 and length(trim("idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_creation_requests_requester_key_uq_idx` ON `agent_profile_creation_requests` (`organization_id`,`requester_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_profile_creation_requests_requester_status_idx` ON `agent_profile_creation_requests` (`organization_id`,`requester_user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_profile_creation_requests_target_status_idx` ON `agent_profile_creation_requests` (`organization_id`,`target_owner_user_id`,`status`,`updated_at`);