CREATE TABLE `plugin_action_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`source_request_key` text,
	`request_digest` text NOT NULL,
	`request_json` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`decided_at_ms` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_action_requests_operation_idx` ON `plugin_action_requests` (`organization_id`,`user_id`,`actor_profile_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `plugin_action_requests_recipient_idx` ON `plugin_action_requests` (`organization_id`,`user_id`,`state`);
