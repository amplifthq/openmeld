CREATE TABLE `account_sidebar_preferences` (
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`revision` integer NOT NULL,
	`preferences` text NOT NULL,
	PRIMARY KEY(`user_id`, `organization_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
