CREATE TABLE `agent_activity_session_inventory_member_cleanup_requests` (
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`requested_at_ms` integer NOT NULL,
	`last_attempt_at_ms` integer NOT NULL,
	`attempt_count` integer NOT NULL,
	`last_error` text,
	PRIMARY KEY(`organization_id`, `owner_user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_activity_session_inventory_member_cleanup_time_check" CHECK("requested_at_ms" >= 0
        and "last_attempt_at_ms" >= "requested_at_ms"
        and "attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `agent_activity_session_inventory_member_cleanup_due_idx` ON `agent_activity_session_inventory_member_cleanup_requests` (`last_attempt_at_ms`,`requested_at_ms`);