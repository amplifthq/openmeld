ALTER TABLE `inbox_feed_snapshots` ADD `people_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox_feed_snapshots` ADD `conversation_type` text DEFAULT 'all' NOT NULL;