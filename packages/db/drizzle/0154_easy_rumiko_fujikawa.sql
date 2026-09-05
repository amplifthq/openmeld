CREATE TABLE `organization_join_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`space_id` text,
	`requested_by_user_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`reviewed_by_user_id` text,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `organization_join_requests_review_idx` ON `organization_join_requests` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `organization_join_requests_requester_idx` ON `organization_join_requests` (`requested_by_user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_join_requests_pending_recipient_uidx` ON `organization_join_requests` (`organization_id`,`email`) WHERE "organization_join_requests"."status" = 'pending' AND "organization_join_requests"."space_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_join_requests_pending_space_recipient_uidx` ON `organization_join_requests` (`organization_id`,`space_id`,`email`) WHERE "organization_join_requests"."status" = 'pending' AND "organization_join_requests"."space_id" IS NOT NULL;--> statement-breakpoint
DROP INDEX `organization_join_links_active_organization_uidx`;--> statement-breakpoint
ALTER TABLE `organization_join_links` ADD `space_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_join_links_active_space_uidx` ON `organization_join_links` (`organization_id`,`space_id`) WHERE "revoked_at" is null AND "space_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_join_links_active_organization_uidx` ON `organization_join_links` (`organization_id`) WHERE "revoked_at" is null AND "space_id" is null;--> statement-breakpoint
ALTER TABLE `space_invitations` ADD `sponsor_user_id` text;