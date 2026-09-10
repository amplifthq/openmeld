CREATE TABLE `space_owner_member_references` (
	`space_id` text NOT NULL,
	`member_id` text NOT NULL,
	PRIMARY KEY(`space_id`, `member_id`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_space_owner_member_references_member` ON `space_owner_member_references` (`member_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO space_owner_member_references (space_id, member_id)
SELECT s.space_id, m.id FROM space_index_spaces s
JOIN members m ON m.organization_id = s.organization_id AND m.user_id = s.creator_owner_user_id
WHERE s.status = 'active' AND (s.space_purpose IS NOT 'openmeld_dm_space' OR s.direct_message_converted_at_ms IS NOT NULL);
