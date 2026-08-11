ALTER TABLE `slack_user_identity_link_tokens` ADD `claimed_at_ms` integer;--> statement-breakpoint
ALTER TABLE `slack_user_identity_link_tokens` ADD `claimed_by_user_id` text;--> statement-breakpoint
ALTER TABLE `slack_user_identity_link_tokens` ADD `continuation_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `slack_user_identity_link_tokens` ADD `delivery_scope` text;