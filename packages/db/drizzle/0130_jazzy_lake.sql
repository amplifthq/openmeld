CREATE TABLE `organization_member_activity` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`human_profile_id` text NOT NULL,
	`last_active_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_member_activity_profile_id_check" CHECK(length(trim("human_profile_id")) > 0),
	CONSTRAINT "organization_member_activity_last_active_at_check" CHECK("last_active_at_ms" >= 0),
	CONSTRAINT "organization_member_activity_updated_at_check" CHECK("updated_at_ms" >= "last_active_at_ms")
);
