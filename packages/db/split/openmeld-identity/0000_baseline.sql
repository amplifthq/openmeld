-- openmeld-identity baseline 0000 (faithful DDL from the frozen source schema, 2026-06-13)
-- 10 tables; CDT and retired start_* tables omitted. Do not hand-edit.
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`username` text,
	`display_username` text,
	`normalized_email` text
);
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
CREATE TABLE `device_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`client_id` text,
	`scope` text
);
CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "openmeld_profiles" (
	`profile_id` text PRIMARY KEY NOT NULL,
	`profile_name` text NOT NULL,
	`profile_handle` text NOT NULL,
	`profile_kind` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_by_user_id` text,
	`creator_profile_id` text,
	`source` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "openmeld_profiles_profile_kind_check" CHECK("profile_kind" in ('human', 'agent', 'system')),
	CONSTRAINT "openmeld_profiles_status_check" CHECK("status" in ('active', 'disabled')),
	CONSTRAINT "openmeld_profiles_source_check" CHECK("source" in ('auth_bootstrap', 'cli_create', 'migration')),
	CONSTRAINT "openmeld_profiles_default_profile_check" CHECK("is_default" = 0 or "profile_kind" = 'human'),
	CONSTRAINT "openmeld_profiles_profile_handle_check" CHECK(length(trim("profile_handle")) > 0 and "profile_handle" not glob '*[^A-Za-z0-9._-]*' and substr(trim("profile_handle"), 1, 1) glob '[A-Za-z0-9]' and length(trim("profile_handle")) <= 128),
	CONSTRAINT "openmeld_profiles_profile_id_format_check" CHECK(( ("profile_kind" = 'agent' and length("profile_id") = 40 and substr("profile_id", 1, 4) = 'agt_' and length(substr("profile_id", 5)) = 36 and substr("profile_id", 5) not glob '*[^0-9a-f-]*' and length(replace(substr("profile_id", 5), '-', '')) = 32 and substr(substr("profile_id", 5), 9, 1) = '-' and substr(substr("profile_id", 5), 14, 1) = '-' and substr(substr("profile_id", 5), 19, 1) = '-' and substr(substr("profile_id", 5), 24, 1) = '-') or ("profile_kind" in ('human', 'system') and length("profile_id") = 36 and "profile_id" not glob '*[^0-9a-f-]*' and length(replace("profile_id", '-', '')) = 32 and substr("profile_id", 9, 1) = '-' and substr("profile_id", 14, 1) = '-' and substr("profile_id", 19, 1) = '-' and substr("profile_id", 24, 1) = '-') ))
);
CREATE TABLE `openmeld_profile_space_history` (
	`profile_id` text NOT NULL,
	`gateway_host` text NOT NULL,
	`space_id` text NOT NULL,
	`space_name` text,
	`creator_profile_id` text,
	`creator_kind` text,
	`space_created_at` integer,
	`space_updated_at` integer,
	`last_joined_at` integer NOT NULL,
	`last_seen_ts` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `pinned_at` integer,
	FOREIGN KEY (`profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "openmeld_profile_space_history_status_check" CHECK("status" in ('active', 'removed', 'inaccessible')),
	CONSTRAINT "openmeld_profile_space_history_creator_kind_check" CHECK("creator_kind" is null or "creator_kind" in ('human', 'agent', 'system')),
	CONSTRAINT "openmeld_profile_space_history_last_seen_ts_check" CHECK("last_seen_ts" is null or "last_seen_ts" >= 0)
);
CREATE TABLE `openmeld_space_deletion_tombstones` (
	`gateway_host` text NOT NULL,
	`space_id` text NOT NULL,
	`space_name` text,
	`creator_profile_id` text,
	`creator_kind` text,
	`deleted_by_profile_id` text,
	`deleted_by_profile_name` text,
	`deleted_by_owner_user_id` text,
	`deleted_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "openmeld_space_deletion_tombstones_creator_kind_check" CHECK("creator_kind" is null or "creator_kind" in ('human', 'agent', 'system'))
);
CREATE TABLE `openmeld_waitlist_emails` (
	`email` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
CREATE UNIQUE INDEX `users_normalized_email_unique` ON `users` (`normalized_email`);
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);
CREATE INDEX `sessions_userId_idx` ON `sessions` (`user_id`);
CREATE INDEX `accounts_userId_idx` ON `accounts` (`user_id`);
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);
CREATE INDEX `passkeys_credentialID_idx` ON `passkeys` (`credential_id`);
CREATE INDEX `passkeys_userId_idx` ON `passkeys` (`user_id`);
CREATE UNIQUE INDEX `openmeld_profiles_owner_default_human_uq_idx` ON `openmeld_profiles` (`owner_user_id`) WHERE "profile_kind" = 'human' and "is_default" = 1;
CREATE INDEX `openmeld_profiles_owner_default_idx` ON `openmeld_profiles` (`owner_user_id`,`is_default`);
CREATE UNIQUE INDEX `openmeld_profiles_owner_handle_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`profile_handle`);
CREATE INDEX `openmeld_profiles_owner_kind_idx` ON `openmeld_profiles` (`owner_user_id`,`profile_kind`);
CREATE INDEX `openmeld_profiles_owner_status_idx` ON `openmeld_profiles` (`owner_user_id`,`status`);
CREATE INDEX `openmeld_profiles_owner_user_id_idx` ON `openmeld_profiles` (`owner_user_id`);
CREATE UNIQUE INDEX `openmeld_profile_space_history_profile_gateway_space_uq_idx` ON `openmeld_profile_space_history` (`profile_id`,`gateway_host`,`space_id`);
CREATE INDEX `openmeld_profile_space_history_profile_gateway_status_joined_idx` ON `openmeld_profile_space_history` (`profile_id`,`gateway_host`,`status`,`last_joined_at`);
CREATE INDEX `openmeld_profile_space_history_profile_gateway_status_pinned_idx` ON `openmeld_profile_space_history` (`profile_id`,`gateway_host`,`status`,`pinned_at`);
CREATE INDEX `openmeld_profile_space_history_profile_gateway_updated_idx` ON `openmeld_profile_space_history` (`profile_id`,`gateway_host`,`updated_at`);
CREATE INDEX `openmeld_space_deletion_tombstones_gateway_deleted_idx` ON `openmeld_space_deletion_tombstones` (`gateway_host`,`deleted_at`);
CREATE UNIQUE INDEX `openmeld_space_deletion_tombstones_gateway_space_uq_idx` ON `openmeld_space_deletion_tombstones` (`gateway_host`,`space_id`);
