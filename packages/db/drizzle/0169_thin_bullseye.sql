CREATE TABLE `organization_member_presence_sessions` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`human_profile_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`last_interaction_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`, `session_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_member_presence_sequence_check" CHECK("sequence" > 0)
);
--> statement-breakpoint
CREATE INDEX `organization_member_presence_expiry_idx` ON `organization_member_presence_sessions` (`organization_id`,`expires_at_ms`);