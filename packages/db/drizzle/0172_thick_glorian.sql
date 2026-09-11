CREATE TABLE `plugin_action_confirmations` (
	`token` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`request_signature` text NOT NULL,
	`access_revision` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plugin_action_confirmations_expiry_idx` ON `plugin_action_confirmations` (`expires_at_ms`);