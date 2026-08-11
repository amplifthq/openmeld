CREATE TABLE `center_agent_task_authorized_readers` (
	`task_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_scope` text DEFAULT 'requester_private' NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`task_id`, `user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_task_authorized_readers_scope_check" CHECK("access_scope" = 'requester_private'),
	CONSTRAINT "center_agent_task_authorized_readers_updated_at_check" CHECK("updated_at_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX `center_agent_task_authorized_readers_user_idx` ON `center_agent_task_authorized_readers` (`organization_id`,`user_id`,`task_id`);--> statement-breakpoint
-- full-shared-schema-only
INSERT INTO `center_agent_task_authorized_readers` (
	`task_id`,
	`organization_id`,
	`user_id`,
	`access_scope`,
	`updated_at_ms`
)
SELECT
	`id`,
	`organization_id`,
	`requester_user_id`,
	'requester_private',
	`updated_at_ms`
FROM `center_agent_tasks`
WHERE `requester_user_id` IS NOT NULL;
