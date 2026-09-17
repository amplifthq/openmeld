CREATE TABLE `connector_access_events` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_name` text NOT NULL,
	`organization_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`revision` integer NOT NULL,
	`previous_policy` text NOT NULL,
	`policy` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "connector_access_events_policy_json_check" CHECK(json_valid("policy") and json_valid("previous_policy"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_access_events_connection_revision_unique` ON `connector_access_events` (`connection_name`,`revision`);--> statement-breakpoint
CREATE INDEX `connector_access_events_org_created_idx` ON `connector_access_events` (`organization_id`,`created_at_ms`);--> statement-breakpoint
ALTER TABLE `connector_connections` ADD `access_policy` text;--> statement-breakpoint
ALTER TABLE `connector_connections` ADD `access_revision` integer DEFAULT 0 NOT NULL;