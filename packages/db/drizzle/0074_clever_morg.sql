CREATE TABLE `organization_skill_activations` (
	`activated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`digest` text NOT NULL,
	`organization_id` text NOT NULL,
	`release_id` text NOT NULL,
	`routine_run_id` text,
	`skill_id` text NOT NULL,
	`submission_id` text NOT NULL,
	PRIMARY KEY(`organization_id`, `submission_id`, `skill_id`, `release_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`release_id`) REFERENCES `organization_skill_releases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skill_id`) REFERENCES `organization_skills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "organization_skill_activations_digest_check" CHECK(length("digest") = 64 and "digest" not glob '*[^a-f0-9]*')
);
--> statement-breakpoint
CREATE INDEX `organization_skill_activations_skill_time_idx` ON `organization_skill_activations` (`organization_id`,`skill_id`,"activated_at" desc);