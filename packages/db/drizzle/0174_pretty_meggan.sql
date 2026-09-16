CREATE TABLE `inbox_conversation_notification_preferences` (
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`space_id` text NOT NULL,
	`mode` text NOT NULL,
	PRIMARY KEY(`user_id`, `organization_id`, `space_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inbox_conversation_notification_preferences_mode_check" CHECK("inbox_conversation_notification_preferences"."mode" in ('all_messages', 'mentions_and_replies', 'muted')),
	CONSTRAINT "inbox_conversation_notification_preferences_space_check" CHECK(length(trim("inbox_conversation_notification_preferences"."space_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE `inbox_message_notification_defaults` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inbox_message_notification_defaults_mode_check" CHECK("inbox_message_notification_defaults"."mode" in ('all_messages', 'mentions_and_replies'))
);
