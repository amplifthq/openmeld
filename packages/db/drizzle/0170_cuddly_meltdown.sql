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
CREATE INDEX `organization_member_presence_expiry_idx` ON `organization_member_presence_sessions` (`organization_id`,`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_rce_profile_updated` ON `openMeldDaemon_runtime_coordinator_executions` (`target_profile_id`,"updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_native_delivery_org_profile_updated` ON `openMeldRemoteAgent_native_delivery_ledger` (`organization_id`,`profile_id`,"updated_at_ms" desc);