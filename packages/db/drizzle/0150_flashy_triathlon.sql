CREATE TABLE `inbox_space_thread_read_watermarks` (
	`organization_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`space_id` text NOT NULL,
	`thread_root_signal_id` text NOT NULL,
	`through_occurred_at_ms` integer NOT NULL,
	`read_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inbox_space_thread_read_watermarks_identity_non_empty_check" CHECK(length(trim("organization_id")) > 0 and length(trim("recipient_user_id")) > 0 and length(trim("space_id")) > 0 and length(trim("thread_root_signal_id")) > 0),
	CONSTRAINT "inbox_space_thread_read_watermarks_timestamps_check" CHECK("through_occurred_at_ms" >= 0 and "read_at_ms" >= 0 and "created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_space_thread_read_watermarks_scope_unique` ON `inbox_space_thread_read_watermarks` (`organization_id`,`recipient_user_id`,`space_id`,`thread_root_signal_id`);