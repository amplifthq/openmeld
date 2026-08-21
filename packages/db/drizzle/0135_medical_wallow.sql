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
CREATE UNIQUE INDEX `agent_profile_creation_requests_requester_key_uq_idx` ON `agent_profile_creation_requests` (`organization_id`,`requester_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_profile_creation_requests_requester_status_idx` ON `agent_profile_creation_requests` (`organization_id`,`requester_user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_profile_creation_requests_target_status_idx` ON `agent_profile_creation_requests` (`organization_id`,`target_owner_user_id`,`status`,`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_openmeld_profiles` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`profile_name` text NOT NULL,
	`profile_handle` text NOT NULL,
	`profile_kind` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`organization_id` text DEFAULT null,
	`owner_user_id` text NOT NULL,
	`created_by_user_id` text,
	`creator_profile_id` text,
	`creation_actor_profile_id` text,
	`source` text NOT NULL,
	`managed_role` text,
	`creation_idempotency_key` text,
	`default_project_id` text,
	`last_used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "openmeld_profiles_profile_kind_check" CHECK("profile_kind" in ('human', 'agent', 'system')),
	CONSTRAINT "openmeld_profiles_status_check" CHECK("status" in ('active', 'disabled')),
	CONSTRAINT "openmeld_profiles_source_check" CHECK("source" in ('auth_bootstrap', 'web_create', 'cli_create', 'local_agent_create', 'center_agent_create', 'migration')),
	CONSTRAINT "openmeld_profiles_managed_role_check" CHECK("managed_role" is null or ("profile_kind" = 'agent' and "managed_role" in ('openmeld_assistant', 'center_agent'))),
	CONSTRAINT "openmeld_profiles_default_project_check" CHECK("default_project_id" is null or (length(trim("default_project_id")) > 0 and "profile_kind" = 'agent' and "managed_role" is null and "organization_id" is not null)),
	CONSTRAINT "openmeld_profiles_default_profile_check" CHECK("is_default" = 0 or "profile_kind" = 'human'),
	CONSTRAINT "openmeld_profiles_profile_handle_check" CHECK(length(trim("profile_handle")) > 0 and "profile_handle" not glob '*[^A-Za-z0-9._-]*' and substr(trim("profile_handle"), 1, 1) glob '[A-Za-z0-9]' and length(trim("profile_handle")) <= 128),
	CONSTRAINT "openmeld_profiles_profile_id_format_check" CHECK(( ("profile_kind" = 'agent' and length("profile_id") = 40 and substr("profile_id", 1, 4) = 'agt_' and length(substr("profile_id", 5)) = 36 and substr("profile_id", 5) not glob '*[^0-9a-f-]*' and length(replace(substr("profile_id", 5), '-', '')) = 32 and substr(substr("profile_id", 5), 9, 1) = '-' and substr(substr("profile_id", 5), 14, 1) = '-' and substr(substr("profile_id", 5), 19, 1) = '-' and substr(substr("profile_id", 5), 24, 1) = '-') or ("profile_kind" in ('human', 'system') and length("profile_id") = 36 and "profile_id" not glob '*[^0-9a-f-]*' and length(replace("profile_id", '-', '')) = 32 and substr("profile_id", 9, 1) = '-' and substr("profile_id", 14, 1) = '-' and substr("profile_id", 19, 1) = '-' and substr("profile_id", 24, 1) = '-') )),
	CONSTRAINT "openmeld_profiles_organization_profile_kind_check" CHECK((("profile_kind" = 'agent' and "organization_id" is not null) or ("profile_kind" in ('human', 'system') and "organization_id" is null)))
);
--> statement-breakpoint
INSERT INTO `__new_openmeld_profiles`("profile_id", "profile_name", "profile_handle", "profile_kind", "is_default", "status", "organization_id", "owner_user_id", "created_by_user_id", "creator_profile_id", "creation_actor_profile_id", "source", "managed_role", "creation_idempotency_key", "default_project_id", "last_used_at", "created_at", "updated_at") SELECT "profile_id", "profile_name", "profile_handle", "profile_kind", "is_default", "status", "organization_id", "owner_user_id", "created_by_user_id", "creator_profile_id", NULL, "source", "managed_role", "creation_idempotency_key", "default_project_id", "last_used_at", "created_at", "updated_at" FROM `openmeld_profiles`;--> statement-breakpoint
DROP TABLE `openmeld_profiles`;--> statement-breakpoint
ALTER TABLE `__new_openmeld_profiles` RENAME TO `openmeld_profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_user_id_idx` ON `openmeld_profiles` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_kind_idx` ON `openmeld_profiles` (`owner_user_id`,`profile_kind`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_organization_kind_idx` ON `openmeld_profiles` (`organization_id`,`profile_kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_handle_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`profile_handle`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_default_idx` ON `openmeld_profiles` (`owner_user_id`,`is_default`);--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_default_human_uq_idx` ON `openmeld_profiles` (`owner_user_id`) WHERE "profile_kind" = 'human' and "is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_managed_role_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`managed_role`) WHERE "managed_role" is not null and "managed_role" != 'center_agent' and "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_org_center_agent_uq_idx` ON `openmeld_profiles` (`organization_id`,`managed_role`) WHERE "managed_role" = 'center_agent' and "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_creation_idempotency_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`creation_idempotency_key`) WHERE "creation_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_status_idx` ON `openmeld_profiles` (`owner_user_id`,`status`);
