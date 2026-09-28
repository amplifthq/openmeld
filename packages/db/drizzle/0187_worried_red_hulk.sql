ALTER TABLE `projects` ADD `additional_repository_urls_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `repository_settings_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `repository_settings_updated_by_user_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `repository_settings_updated_at_ms` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `common_agent_profile_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `common_agents_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `common_agents_updated_by_user_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `common_agents_updated_at_ms` integer;