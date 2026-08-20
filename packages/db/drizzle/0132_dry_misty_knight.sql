PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_profile_creation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requester_user_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`target_owner_user_id` text NOT NULL,
	`source` text NOT NULL,
	`profile_name` text NOT NULL,
	`configuration_json` text DEFAULT '{"agentControllerPermissionMode":null,"agentControllerRef":null,"authorizeForOrganization":true,"defaultProjectId":null,"modelId":null,"openCodePermission":null,"reasoningLevel":null,"targetComputerId":null}' NOT NULL,
	`session_strategy` text NOT NULL,
	`native_session_id` text,
	`requested_space_id` text,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`status_reason` text NOT NULL,
	`created_agent_profile_id` text,
	`failure_message` text,
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
	CONSTRAINT "agent_profile_creation_requests_completion_check" CHECK(("status" = 'completed' and "created_agent_profile_id" is not null and "completed_at" is not null) or ("status" = 'failed' and "completed_at" is null) or ("status" not in ('completed', 'failed') and "created_agent_profile_id" is null and "completed_at" is null)),
	CONSTRAINT "agent_profile_creation_requests_failure_check" CHECK(("status" = 'failed' and "failure_message" is not null and length(trim("failure_message")) > 0) or ("status" != 'failed' and "failure_message" is null)),
	CONSTRAINT "agent_profile_creation_requests_required_text_check" CHECK(length(trim("id")) > 0 and length(trim("actor_profile_id")) > 0 and length(trim("profile_name")) > 0 and length(trim("idempotency_key")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_agent_profile_creation_requests`("id", "organization_id", "requester_user_id", "actor_profile_id", "target_owner_user_id", "source", "profile_name", "configuration_json", "session_strategy", "native_session_id", "requested_space_id", "idempotency_key", "status", "status_reason", "created_agent_profile_id", "failure_message", "decided_at", "completed_at", "created_at", "updated_at") SELECT "id", "organization_id", "requester_user_id", "actor_profile_id", "target_owner_user_id", "source", "profile_name", '{"agentControllerPermissionMode":null,"agentControllerRef":null,"authorizeForOrganization":true,"defaultProjectId":null,"modelId":null,"openCodePermission":null,"reasoningLevel":null,"targetComputerId":null}', "session_strategy", "native_session_id", "requested_space_id", "idempotency_key", "status", "status_reason", "created_agent_profile_id", CASE WHEN "status" = 'failed' THEN 'OpenMeld couldn''t finish creating this Agent.' ELSE NULL END, "decided_at", "completed_at", "created_at", "updated_at" FROM `agent_profile_creation_requests`;--> statement-breakpoint
DROP TABLE `agent_profile_creation_requests`;--> statement-breakpoint
ALTER TABLE `__new_agent_profile_creation_requests` RENAME TO `agent_profile_creation_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_creation_requests_requester_key_uq_idx` ON `agent_profile_creation_requests` (`organization_id`,`requester_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_profile_creation_requests_requester_status_idx` ON `agent_profile_creation_requests` (`organization_id`,`requester_user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_profile_creation_requests_target_status_idx` ON `agent_profile_creation_requests` (`organization_id`,`target_owner_user_id`,`status`,`updated_at`);
