DROP INDEX `organization_join_links_active_organization_uidx`;--> statement-breakpoint
DROP INDEX `organization_join_links_active_space_uidx`;--> statement-breakpoint
ALTER TABLE `organization_join_links` ADD `mode` text DEFAULT 'request' NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_join_links` ADD `expires_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_join_links_active_organization_uidx` ON `organization_join_links` (`organization_id`,`mode`) WHERE "revoked_at" is null AND "space_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_join_links_active_space_uidx` ON `organization_join_links` (`organization_id`,`space_id`,`mode`) WHERE "revoked_at" is null AND "space_id" is not null;--> statement-breakpoint
ALTER TABLE `organization_join_requests` ADD `applicant_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `organization_join_requests` ADD `joined_at` integer;