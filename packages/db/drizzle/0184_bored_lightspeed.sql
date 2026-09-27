CREATE TABLE `organization_skill_import_batches` (
	`batch_id` text NOT NULL,
	`commit_sha` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`preview_json` text NOT NULL,
	`repository` text NOT NULL,
	`results_json` text NOT NULL,
	`source_url` text NOT NULL,
	PRIMARY KEY(`organization_id`, `batch_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
