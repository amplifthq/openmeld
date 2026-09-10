PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_center_agent_designations` (
	`organization_id` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`duty` text,
	`designated_by` text,
	`operating_state` text DEFAULT 'active' NOT NULL,
	`paused_at` integer,
	`paused_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`designated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`paused_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "center_agent_designations_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "center_agent_designations_agent_profile_non_empty_check" CHECK(length(trim("agent_profile_id")) > 0),
	CONSTRAINT "center_agent_designations_designated_by_non_empty_check" CHECK(length(trim("designated_by")) > 0),
	CONSTRAINT "center_agent_designations_operating_state_check" CHECK("operating_state" in ('active', 'paused')),
	CONSTRAINT "center_agent_designations_pause_state_check" CHECK((
        ("operating_state" = 'active' and "paused_at" is null and "paused_by_user_id" is null)
        or
        ("operating_state" = 'paused' and "paused_at" is not null)
      )),
	CONSTRAINT "center_agent_designations_mvp_duty_null_check" CHECK("duty" is null)
);
--> statement-breakpoint
INSERT INTO `__new_center_agent_designations`("organization_id", "agent_profile_id", "duty", "designated_by", "operating_state", "paused_at", "paused_by_user_id", "created_at") SELECT "organization_id", "agent_profile_id", "duty", "designated_by", "operating_state", "paused_at", "paused_by_user_id", "created_at" FROM `center_agent_designations`;--> statement-breakpoint
DROP TABLE `center_agent_designations`;--> statement-breakpoint
ALTER TABLE `__new_center_agent_designations` RENAME TO `center_agent_designations`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_designations_org_uq_idx` ON `center_agent_designations` (`organization_id`);--> statement-breakpoint
CREATE INDEX `center_agent_designations_agent_profile_idx` ON `center_agent_designations` (`agent_profile_id`);--> statement-breakpoint
CREATE INDEX `center_agent_designations_designated_by_idx` ON `center_agent_designations` (`designated_by`);
