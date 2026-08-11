CREATE TABLE `center_agent_memory_policies` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`organization_memory_opt_in` integer DEFAULT false NOT NULL,
	`updated_by_user_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "center_agent_memory_policies_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "center_agent_memory_policies_opt_in_boolean_check" CHECK("organization_memory_opt_in" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `center_agent_memory_subjects` (
	`subject_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`member_id` text,
	`member_user_id` text,
	`provider` text DEFAULT 'zep_cloud' NOT NULL,
	`zep_user_id` text,
	`zep_graph_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	`last_error` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`member_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_memory_subjects_id_non_empty_check" CHECK(length(trim("subject_id")) > 0),
	CONSTRAINT "center_agent_memory_subjects_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "center_agent_memory_subjects_kind_check" CHECK("subject_kind" in ('member', 'organization')),
	CONSTRAINT "center_agent_memory_subjects_provider_check" CHECK("provider" = 'zep_cloud'),
	CONSTRAINT "center_agent_memory_subjects_status_check" CHECK("status" in ('active', 'deleting', 'deleted', 'delete_failed')),
	CONSTRAINT "center_agent_memory_subjects_member_shape_check" CHECK(
        ("subject_kind" != 'member')
        or (
          "member_user_id" is not null
          and "zep_user_id" is not null
          and "zep_graph_id" is null
        )
      ),
	CONSTRAINT "center_agent_memory_subjects_org_shape_check" CHECK(
        ("subject_kind" != 'organization')
        or (
          "member_id" is null
          and "member_user_id" is null
          and "zep_user_id" is null
          and "zep_graph_id" is not null
        )
      )
);
--> statement-breakpoint
CREATE INDEX `center_agent_memory_subjects_org_kind_idx` ON `center_agent_memory_subjects` (`organization_id`,`subject_kind`);
--> statement-breakpoint
CREATE INDEX `center_agent_memory_subjects_member_user_idx` ON `center_agent_memory_subjects` (`organization_id`,`member_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_memory_subjects_zep_user_uq_idx` ON `center_agent_memory_subjects` (`zep_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_memory_subjects_zep_graph_uq_idx` ON `center_agent_memory_subjects` (`zep_graph_id`);
