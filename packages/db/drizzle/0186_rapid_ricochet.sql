ALTER TABLE `projects` ADD `issue_destination_json` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `issue_destination_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `issue_destination_updated_by_user_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `issue_destination_updated_at_ms` integer;