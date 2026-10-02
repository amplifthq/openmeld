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
--> statement-breakpoint
CREATE TABLE `organization_skill_import_operations` (
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`operation_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`request_signature` text NOT NULL,
	`response_json` text,
	PRIMARY KEY(`organization_id`, `operation_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_skill_import_operations_completion_check" CHECK(("completed_at" is null and "response_json" is null) or ("completed_at" is not null and "response_json" is not null))
);
