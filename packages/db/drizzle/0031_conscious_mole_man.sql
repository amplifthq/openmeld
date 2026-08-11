CREATE TABLE `organization_join_links` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`token` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_join_links_token_uidx` ON `organization_join_links` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_join_links_active_organization_uidx` ON `organization_join_links` (`organization_id`) WHERE "revoked_at" is null;--> statement-breakpoint
CREATE INDEX `organization_join_links_created_by_idx` ON `organization_join_links` (`created_by`);