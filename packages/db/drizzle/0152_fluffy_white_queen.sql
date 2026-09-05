CREATE TABLE `space_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`space_id` text NOT NULL,
	`email` text NOT NULL,
	`inviter_user_id` text NOT NULL,
	`organization_invitation_id` text,
	`organization_invitation_owned` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_space_invitations_recipient` ON `space_invitations` (`email`,`status`);--> statement-breakpoint
CREATE INDEX `idx_space_invitations_space` ON `space_invitations` (`space_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_space_invitations_pending_recipient` ON `space_invitations` (`space_id`,`email`) WHERE "space_invitations"."status" IN ('pending', 'accepting');