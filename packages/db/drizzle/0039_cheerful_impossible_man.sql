CREATE TABLE `center_agent_member_research_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`scope` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`requested_by_member_id` text NOT NULL,
	`requested_by_profile_id` text NOT NULL,
	`requested_by_display_name` text NOT NULL,
	`direct_message_space_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_member_research_batches_scope_check" CHECK("scope" in ('member', 'all')),
	CONSTRAINT "center_agent_member_research_batches_status_check" CHECK("status" in ('queued', 'running', 'completed')),
	CONSTRAINT "center_agent_member_research_batches_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_member_research_one_active_batch_per_org` ON `center_agent_member_research_batches` (`organization_id`) WHERE "status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX `center_agent_member_research_batches_org_created_idx` ON `center_agent_member_research_batches` (`organization_id`,"created_at_ms" desc);--> statement-breakpoint
CREATE INDEX `center_agent_member_research_batches_status_updated_idx` ON `center_agent_member_research_batches` (`status`,"updated_at_ms" asc);--> statement-breakpoint
CREATE TABLE `center_agent_member_research_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`subject_user_id` text NOT NULL,
	`subject_display_name` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`failure_code` text,
	`created_at_ms` integer NOT NULL,
	`started_at_ms` integer,
	`finished_at_ms` integer,
	FOREIGN KEY (`batch_id`) REFERENCES `center_agent_member_research_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_member_research_tasks_position_check" CHECK("position" > 0),
	CONSTRAINT "center_agent_member_research_tasks_status_check" CHECK("status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "center_agent_member_research_tasks_timestamps_check" CHECK(("status" = 'queued' and "started_at_ms" is null and "finished_at_ms" is null) or ("status" = 'running' and "started_at_ms" is not null and "finished_at_ms" is null) or ("status" in ('completed', 'failed') and "started_at_ms" is not null and "finished_at_ms" is not null and "finished_at_ms" >= "started_at_ms")),
	CONSTRAINT "center_agent_member_research_tasks_failure_check" CHECK(("status" = 'failed' and "failure_code" is not null) or ("status" != 'failed' and "failure_code" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_member_research_tasks_batch_subject_unique` ON `center_agent_member_research_tasks` (`batch_id`,`subject_user_id`);--> statement-breakpoint
CREATE INDEX `center_agent_member_research_tasks_batch_position_idx` ON `center_agent_member_research_tasks` (`batch_id`,`position`);--> statement-breakpoint
CREATE INDEX `center_agent_member_research_tasks_status_started_idx` ON `center_agent_member_research_tasks` (`status`,`started_at_ms`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_organization_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_user_id` text,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`draft_content` text,
	`draft_created_by` text,
	`draft_created_at` integer,
	`last_member_research_task_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_documents_kind_check" CHECK("kind" in ('brief', 'member_profile', 'knowledge')),
	CONSTRAINT "organization_documents_subject_check" CHECK(("kind" = 'member_profile' and "subject_user_id" is not null) or ("kind" != 'member_profile' and "subject_user_id" is null)),
	CONSTRAINT "organization_documents_brief_title_check" CHECK("kind" != 'brief' or "title" = 'Organization Brief'),
	CONSTRAINT "organization_documents_title_check" CHECK(length(trim("title")) between 1 and 200),
	CONSTRAINT "organization_documents_content_length_check" CHECK(length("content") <= 20000),
	CONSTRAINT "organization_documents_draft_content_length_check" CHECK("draft_content" is null or length("draft_content") <= 20000),
	CONSTRAINT "organization_documents_draft_metadata_check" CHECK(("draft_content" is null and "draft_created_by" is null and "draft_created_at" is null) or ("draft_content" is not null and "draft_created_by" = 'center_agent' and "draft_created_at" is not null)),
	CONSTRAINT "organization_documents_member_research_check" CHECK("last_member_research_task_id" is null or "kind" = 'member_profile'),
	CONSTRAINT "organization_documents_updated_at_check" CHECK("updated_at" >= "created_at")
);
--> statement-breakpoint
INSERT INTO `__new_organization_documents`("id", "organization_id", "kind", "subject_user_id", "title", "content", "draft_content", "draft_created_by", "draft_created_at", "last_member_research_task_id", "created_at", "updated_at") SELECT "id", "organization_id", "kind", "subject_user_id", "title", "content", "draft_content", "draft_created_by", "draft_created_at", NULL, "created_at", "updated_at" FROM `organization_documents`;--> statement-breakpoint
DROP TABLE `organization_documents`;--> statement-breakpoint
ALTER TABLE `__new_organization_documents` RENAME TO `organization_documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_documents_org_brief_unique` ON `organization_documents` (`organization_id`) WHERE "kind" = 'brief';--> statement-breakpoint
CREATE UNIQUE INDEX `organization_documents_org_member_profile_unique` ON `organization_documents` (`organization_id`,`subject_user_id`) WHERE "kind" = 'member_profile';--> statement-breakpoint
CREATE UNIQUE INDEX `organization_documents_member_research_task_unique` ON `organization_documents` (`last_member_research_task_id`) WHERE "last_member_research_task_id" is not null;--> statement-breakpoint
CREATE INDEX `organization_documents_org_kind_updated_idx` ON `organization_documents` (`organization_id`,`kind`,"updated_at" desc);
