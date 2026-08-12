PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_center_agent_memory_policies` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`organization_memory_opt_in` integer DEFAULT true NOT NULL,
	`updated_by_user_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "center_agent_memory_policies_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "center_agent_memory_policies_opt_in_boolean_check" CHECK("organization_memory_opt_in" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_center_agent_memory_policies`("organization_id", "organization_memory_opt_in", "updated_by_user_id", "created_at_ms", "updated_at_ms") SELECT "organization_id", "organization_memory_opt_in", "updated_by_user_id", "created_at_ms", "updated_at_ms" FROM `center_agent_memory_policies`;--> statement-breakpoint
DROP TABLE `center_agent_memory_policies`;--> statement-breakpoint
ALTER TABLE `__new_center_agent_memory_policies` RENAME TO `center_agent_memory_policies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;