CREATE TABLE `center_agent_organization_skill_operations` (
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`operation_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`request_signature` text NOT NULL,
	`response_json` text,
	PRIMARY KEY(`organization_id`, `operation_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_organization_skill_operations_completion_check" CHECK(("completed_at" is null and "response_json" is null) or ("completed_at" is not null and "response_json" is not null))
);
--> statement-breakpoint
CREATE TABLE `organization_skill_maintainers` (
	`assigned_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`assigned_by_user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`skill_id`, `user_id`),
	FOREIGN KEY (`assigned_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `organization_skills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organization_skill_maintainers_org_user_idx` ON `organization_skill_maintainers` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `organization_skill_releases` (
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_by_user_id` text NOT NULL,
	`digest` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`manifest_json` text NOT NULL,
	`object_key` text NOT NULL,
	`organization_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`source_commit_sha` text,
	`source_kind` text NOT NULL,
	`source_path` text,
	`source_repository` text,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `organization_skills`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_skill_releases_digest_check" CHECK(length("digest") = 64 and "digest" not glob '*[^a-f0-9]*'),
	CONSTRAINT "organization_skill_releases_source_kind_check" CHECK("source_kind" in ('created', 'github'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_skill_releases_object_key_unique` ON `organization_skill_releases` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_skill_releases_skill_digest_unique` ON `organization_skill_releases` (`skill_id`,`digest`);--> statement-breakpoint
CREATE INDEX `organization_skill_releases_skill_created_idx` ON `organization_skill_releases` (`skill_id`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `organization_skills` (
	`active_release_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_by_user_id` text NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organization_id` text NOT NULL,
	`removed_at` integer,
	`source_commit_sha` text,
	`source_kind` text NOT NULL,
	`source_path` text,
	`source_repository` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_skills_source_kind_check" CHECK("source_kind" in ('created', 'github')),
	CONSTRAINT "organization_skills_source_shape_check" CHECK(("source_kind" = 'created' and "source_repository" is null and "source_path" is null and "source_commit_sha" is null) or ("source_kind" = 'github' and "source_repository" is not null and "source_path" is not null and "source_commit_sha" is not null)),
	CONSTRAINT "organization_skills_version_check" CHECK("version" >= 1),
	CONSTRAINT "organization_skills_updated_at_check" CHECK("updated_at" >= "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_skills_org_name_active_unique` ON `organization_skills` (`organization_id`,`name`) WHERE "removed_at" is null;--> statement-breakpoint
CREATE INDEX `organization_skills_org_updated_idx` ON `organization_skills` (`organization_id`,"updated_at" desc);