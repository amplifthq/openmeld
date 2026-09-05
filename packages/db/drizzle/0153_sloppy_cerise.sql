PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_space_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`space_id` text NOT NULL,
	`email` text NOT NULL,
	`inviter_user_id` text NOT NULL,
	`organization_invitation_id` text,
	`organization_invitation_owned` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_space_invitations`("id", "organization_id", "space_id", "email", "inviter_user_id", "organization_invitation_id", "organization_invitation_owned", "status", "created_at", "expires_at") SELECT "id", "organization_id", "space_id", "email", "inviter_user_id", "organization_invitation_id", "organization_invitation_owned", "status", "created_at", "expires_at" FROM `space_invitations`;--> statement-breakpoint
DROP TABLE `space_invitations`;--> statement-breakpoint
ALTER TABLE `__new_space_invitations` RENAME TO `space_invitations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_space_invitations_recipient` ON `space_invitations` (`email`,`status`);--> statement-breakpoint
CREATE INDEX `idx_space_invitations_space` ON `space_invitations` (`space_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_space_invitations_pending_recipient` ON `space_invitations` (`space_id`,`email`) WHERE "space_invitations"."status" IN ('pending', 'accepting');