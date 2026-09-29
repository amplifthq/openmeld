CREATE TABLE `space_task_project_links` (
	`space_id` text NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`task_revision` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`space_id`, `task_id`, `project_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `space_task_project_links_project_updated_idx` ON `space_task_project_links` (`organization_id`,`project_id`,`updated_at_ms`);--> statement-breakpoint
CREATE TABLE `space_task_project_projection_states` (
	`space_id` text NOT NULL,
	`task_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`task_revision` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`space_id`, `task_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
