CREATE TABLE `inbox_feed_snapshot_members` (
	`snapshot_id` text NOT NULL,
	`item_id` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `item_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `inbox_feed_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `inbox_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inbox_feed_snapshot_members_item_idx` ON `inbox_feed_snapshot_members` (`item_id`);--> statement-breakpoint
CREATE TABLE `inbox_feed_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`category` text NOT NULL,
	`unread_only` integer NOT NULL,
	`agents_only` integer NOT NULL,
	`through_row_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inbox_feed_snapshot_category_check" CHECK("category" in ('all', 'mentions', 'needs_action', 'needs_review')),
	CONSTRAINT "inbox_feed_snapshot_cutoff_check" CHECK("through_row_id" >= 0 and "created_at_ms" >= 0 and "expires_at_ms" > "created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `inbox_feed_snapshot_expiry_idx` ON `inbox_feed_snapshots` (`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `inbox_feed_snapshot_recipient_idx` ON `inbox_feed_snapshots` (`recipient_user_id`,`organization_id`,`expires_at_ms`);