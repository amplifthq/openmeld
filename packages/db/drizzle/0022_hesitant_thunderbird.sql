CREATE TABLE `openMeldFeedback_reporting_policies` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`reporting_enabled` integer DEFAULT true NOT NULL,
	`updated_by_user_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "openMeldFeedback_reporting_policies_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "openMeldFeedback_reporting_policies_enabled_boolean_check" CHECK("reporting_enabled" in (0, 1))
);
