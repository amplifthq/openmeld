CREATE TABLE `agent_profile_creation_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`default_project_id` text,
	`model_id` text,
	`reasoning_level` text,
	`agent_controller_permission_mode` text,
	`open_code_permission_json` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_profile_creation_defaults_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "agent_profile_creation_defaults_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "agent_profile_creation_defaults_user_non_empty_check" CHECK(length(trim("user_id")) > 0),
	CONSTRAINT "agent_profile_creation_defaults_controller_non_empty_check" CHECK(length(trim("agent_controller_ref")) > 0),
	CONSTRAINT "agent_profile_creation_defaults_reasoning_model_check" CHECK("reasoning_level" is null or "model_id" is not null),
	CONSTRAINT "agent_profile_creation_defaults_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_creation_defaults_scope_uq_idx` ON `agent_profile_creation_defaults` (`organization_id`,`user_id`,`agent_controller_ref`);--> statement-breakpoint
CREATE INDEX `agent_profile_creation_defaults_user_idx` ON `agent_profile_creation_defaults` (`user_id`);