CREATE TABLE `organization_binding_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`authorized_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`binding_id`) REFERENCES `openMeldDaemon_agent_profile_bindings`(`binding_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authorized_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_binding_authorizations_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "organization_binding_authorizations_organization_id_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "organization_binding_authorizations_binding_id_non_empty_check" CHECK(length(trim("binding_id")) > 0),
	CONSTRAINT "organization_binding_authorizations_authorized_by_non_empty_check" CHECK(length(trim("authorized_by")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_binding_authorizations_org_binding_uq_idx` ON `organization_binding_authorizations` (`organization_id`,`binding_id`);--> statement-breakpoint
CREATE INDEX `organization_binding_authorizations_binding_idx` ON `organization_binding_authorizations` (`binding_id`);--> statement-breakpoint
CREATE INDEX `organization_binding_authorizations_authorized_by_idx` ON `organization_binding_authorizations` (`authorized_by`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_space_index_spaces` (
	`space_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`organization_visibility` text NOT NULL,
	`status` text NOT NULL,
	`space_name` text,
	`space_purpose` text,
	`creator_profile_id` text,
	`creator_kind` text,
	`creator_owner_user_id` text,
	`creator_profile_name` text,
	`space_created_at_ms` integer,
	`space_updated_at_ms` integer,
	`deleted_at_ms` integer,
	`deleted_by_profile_id` text,
	`deleted_by_owner_user_id` text,
	`deleted_by_profile_name` text,
	`source_updated_at_ms` integer NOT NULL,
	`projected_at_ms` integer NOT NULL,
	`projection_event_id` text NOT NULL,
	CONSTRAINT "space_index_spaces_organization_visibility_check" CHECK("organization_visibility" in ('public', 'private')),
	CONSTRAINT "space_index_spaces_organization_id_non_empty_check" CHECK(length(trim("organization_id")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_space_index_spaces`("space_id", "organization_id", "organization_visibility", "status", "space_name", "space_purpose", "creator_profile_id", "creator_kind", "creator_owner_user_id", "creator_profile_name", "space_created_at_ms", "space_updated_at_ms", "deleted_at_ms", "deleted_by_profile_id", "deleted_by_owner_user_id", "deleted_by_profile_name", "source_updated_at_ms", "projected_at_ms", "projection_event_id") SELECT "space_id", NULL, NULL, "status", "space_name", "space_purpose", "creator_profile_id", "creator_kind", "creator_owner_user_id", "creator_profile_name", "space_created_at_ms", "space_updated_at_ms", "deleted_at_ms", "deleted_by_profile_id", "deleted_by_owner_user_id", "deleted_by_profile_name", "source_updated_at_ms", "projected_at_ms", "projection_event_id" FROM `space_index_spaces`;--> statement-breakpoint
DROP TABLE `space_index_spaces`;--> statement-breakpoint
ALTER TABLE `__new_space_index_spaces` RENAME TO `space_index_spaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_space_index_spaces_status_updated` ON `space_index_spaces` (`status`,"source_updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_space_index_spaces_org_visibility_updated` ON `space_index_spaces` (`organization_id`,`organization_visibility`,`status`,"source_updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_space_index_spaces_creator_owner` ON `space_index_spaces` (`creator_owner_user_id`,`status`,"source_updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_space_index_spaces_projection_event` ON `space_index_spaces` (`projection_event_id`);--> statement-breakpoint
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
	`source` text NOT NULL,
	`managed_role` text,
	`last_used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "openmeld_profiles_profile_kind_check" CHECK("profile_kind" in ('human', 'agent', 'system')),
	CONSTRAINT "openmeld_profiles_status_check" CHECK("status" in ('active', 'disabled')),
	CONSTRAINT "openmeld_profiles_source_check" CHECK("source" in ('auth_bootstrap', 'cli_create', 'migration')),
	CONSTRAINT "openmeld_profiles_managed_role_check" CHECK("managed_role" is null or ("profile_kind" = 'agent' and "managed_role" in ('openmeld_assistant'))),
	CONSTRAINT "openmeld_profiles_default_profile_check" CHECK("is_default" = 0 or "profile_kind" = 'human'),
	CONSTRAINT "openmeld_profiles_profile_handle_check" CHECK(length(trim("profile_handle")) > 0 and "profile_handle" not glob '*[^A-Za-z0-9._-]*' and substr(trim("profile_handle"), 1, 1) glob '[A-Za-z0-9]' and length(trim("profile_handle")) <= 128),
	CONSTRAINT "openmeld_profiles_profile_id_format_check" CHECK(( ("profile_kind" = 'agent' and length("profile_id") = 40 and substr("profile_id", 1, 4) = 'agt_' and length(substr("profile_id", 5)) = 36 and substr("profile_id", 5) not glob '*[^0-9a-f-]*' and length(replace(substr("profile_id", 5), '-', '')) = 32 and substr(substr("profile_id", 5), 9, 1) = '-' and substr(substr("profile_id", 5), 14, 1) = '-' and substr(substr("profile_id", 5), 19, 1) = '-' and substr(substr("profile_id", 5), 24, 1) = '-') or ("profile_kind" in ('human', 'system') and length("profile_id") = 36 and "profile_id" not glob '*[^0-9a-f-]*' and length(replace("profile_id", '-', '')) = 32 and substr("profile_id", 9, 1) = '-' and substr("profile_id", 14, 1) = '-' and substr("profile_id", 19, 1) = '-' and substr("profile_id", 24, 1) = '-') )),
	CONSTRAINT "openmeld_profiles_organization_profile_kind_check" CHECK((("profile_kind" = 'agent' and "organization_id" is not null) or ("profile_kind" in ('human', 'system') and "organization_id" is null)))
);
--> statement-breakpoint
INSERT INTO `__new_openmeld_profiles`("profile_id", "profile_name", "profile_handle", "profile_kind", "is_default", "status", "organization_id", "owner_user_id", "created_by_user_id", "creator_profile_id", "source", "managed_role", "last_used_at", "created_at", "updated_at") SELECT "profile_id", "profile_name", "profile_handle", "profile_kind", "is_default", "status", NULL, "owner_user_id", "created_by_user_id", "creator_profile_id", "source", "managed_role", "last_used_at", "created_at", "updated_at" FROM `openmeld_profiles`;--> statement-breakpoint
DROP TABLE `openmeld_profiles`;--> statement-breakpoint
ALTER TABLE `__new_openmeld_profiles` RENAME TO `openmeld_profiles`;--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_user_id_idx` ON `openmeld_profiles` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_kind_idx` ON `openmeld_profiles` (`owner_user_id`,`profile_kind`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_organization_kind_idx` ON `openmeld_profiles` (`organization_id`,`profile_kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_handle_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`profile_handle`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_default_idx` ON `openmeld_profiles` (`owner_user_id`,`is_default`);--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_default_human_uq_idx` ON `openmeld_profiles` (`owner_user_id`) WHERE "profile_kind" = 'human' and "is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_managed_role_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`managed_role`) WHERE "managed_role" is not null and "status" = 'active';--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_status_idx` ON `openmeld_profiles` (`owner_user_id`,`status`);
