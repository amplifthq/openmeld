CREATE TABLE `center_agent_audit_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`action` text NOT NULL,
	`on_behalf_of_profile_id` text,
	`on_behalf_of_user_id` text,
	`on_behalf_of_display_name` text,
	`resource_type` text,
	`resource_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`on_behalf_of_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`on_behalf_of_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "center_agent_audit_journal_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "center_agent_audit_journal_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "center_agent_audit_journal_actor_profile_non_empty_check" CHECK(length(trim("actor_profile_id")) > 0),
	CONSTRAINT "center_agent_audit_journal_action_non_empty_check" CHECK(length(trim("action")) > 0)
);
--> statement-breakpoint
CREATE INDEX `center_agent_audit_journal_org_created_idx` ON `center_agent_audit_journal` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `center_agent_audit_journal_actor_created_idx` ON `center_agent_audit_journal` (`actor_profile_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `center_agent_audit_journal_on_behalf_profile_idx` ON `center_agent_audit_journal` (`on_behalf_of_profile_id`);--> statement-breakpoint
CREATE TABLE `center_agent_designations` (
	`organization_id` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`duty` text,
	`designated_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`designated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_designations_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "center_agent_designations_agent_profile_non_empty_check" CHECK(length(trim("agent_profile_id")) > 0),
	CONSTRAINT "center_agent_designations_designated_by_non_empty_check" CHECK(length(trim("designated_by")) > 0),
	CONSTRAINT "center_agent_designations_mvp_duty_null_check" CHECK("duty" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_designations_org_uq_idx` ON `center_agent_designations` (`organization_id`);--> statement-breakpoint
CREATE INDEX `center_agent_designations_agent_profile_idx` ON `center_agent_designations` (`agent_profile_id`);--> statement-breakpoint
CREATE INDEX `center_agent_designations_designated_by_idx` ON `center_agent_designations` (`designated_by`);
