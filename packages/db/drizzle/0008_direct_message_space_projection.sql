ALTER TABLE `space_index_spaces` ADD `direct_message_pair_key` text;
--> statement-breakpoint
ALTER TABLE `space_index_spaces` ADD `active_member_count` integer;
--> statement-breakpoint
ALTER TABLE `space_index_spaces` ADD `active_human_count` integer;
--> statement-breakpoint
ALTER TABLE `space_index_spaces` ADD `active_agent_count` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_space_index_spaces_org_dm_pair` ON `space_index_spaces` (`organization_id`, `direct_message_pair_key`, `status`);
