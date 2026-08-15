CREATE TABLE `center_agent_member_research_computer_files` (
	`task_id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`subject_user_id` text NOT NULL,
	`path` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `center_agent_member_research_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_member_research_computer_files_path_check" CHECK(length(trim("path")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_member_research_computer_files_document_unique` ON `center_agent_member_research_computer_files` (`document_id`);--> statement-breakpoint
CREATE TABLE `slack_installation_welcome_preparations` (
	`slack_team_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`recipient_slack_user_id` text NOT NULL,
	`connection_created_at_ms` integer NOT NULL,
	`welcome_version` integer NOT NULL,
	`message_kind` text NOT NULL,
	`installed_by_user_id` text NOT NULL,
	`installed_by_profile_id` text NOT NULL,
	`status` text NOT NULL,
	`claim_id` text,
	`research_task_id` text,
	`failure_code` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`slack_team_id`, `organization_id`, `recipient_slack_user_id`, `connection_created_at_ms`, `welcome_version`),
	CONSTRAINT "slack_installation_welcome_preparation_identity_check" CHECK(length(trim("slack_team_id")) > 0
        AND length(trim("organization_id")) > 0
        AND length(trim("recipient_slack_user_id")) > 0
        AND length(trim("installed_by_user_id")) > 0
        AND length(trim("installed_by_profile_id")) > 0),
	CONSTRAINT "slack_installation_welcome_preparation_status_check" CHECK("status" in ('queued', 'researching', 'ready', 'completed', 'failed')),
	CONSTRAINT "slack_installation_welcome_preparation_shape_check" CHECK((
        ("status" = 'queued' AND "claim_id" IS NULL AND "research_task_id" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'researching' AND length(trim("claim_id")) > 0 AND "failure_code" IS NULL)
        OR ("status" = 'ready' AND length(trim("claim_id")) > 0 AND length(trim("research_task_id")) > 0 AND "failure_code" IS NULL)
        OR ("status" = 'completed' AND length(trim("claim_id")) > 0 AND length(trim("research_task_id")) > 0 AND "failure_code" IS NULL)
        OR ("status" = 'failed' AND length(trim("claim_id")) > 0 AND length(trim("failure_code")) > 0)
      )),
	CONSTRAINT "slack_installation_welcome_preparation_time_check" CHECK("connection_created_at_ms" > 0
        AND "welcome_version" > 0
        AND "updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_installation_welcome_preparation_task_unique` ON `slack_installation_welcome_preparations` (`research_task_id`) WHERE "research_task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_slack_installation_welcome_preparation_status_updated` ON `slack_installation_welcome_preparations` (`status`,`updated_at_ms`);--> statement-breakpoint
CREATE TABLE `slack_teammate_invitation_deliveries` (
	`interaction_id` text NOT NULL,
	`slack_team_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`actor_slack_user_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_slack_user_id` text NOT NULL,
	`target_email` text,
	`target_display_name` text NOT NULL,
	`status` text NOT NULL,
	`message_ts` text,
	`failure_code` text,
	`onboarding_status` text,
	`joined_user_id` text,
	`joined_profile_id` text,
	`research_task_id` text,
	`welcome_message_ts` text,
	`onboarding_failure_code` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`interaction_id`, `target_slack_user_id`),
	CONSTRAINT "slack_teammate_invitation_identity_check" CHECK(length(trim("interaction_id")) > 0
        AND length(trim("slack_team_id")) > 0
        AND length(trim("organization_id")) > 0
        AND length(trim("actor_slack_user_id")) > 0
        AND length(trim("actor_user_id")) > 0
        AND length(trim("target_slack_user_id")) > 0
        AND length(trim("target_display_name")) > 0),
	CONSTRAINT "slack_teammate_invitation_status_check" CHECK("status" in ('pending', 'delivered', 'failed', 'outcome_unknown')),
	CONSTRAINT "slack_teammate_invitation_shape_check" CHECK((
        ("status" = 'pending' AND "message_ts" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'delivered' AND length(trim("message_ts")) > 0 AND "failure_code" IS NULL)
        OR ("status" IN ('failed', 'outcome_unknown') AND "message_ts" IS NULL AND length(trim("failure_code")) > 0)
      )),
	CONSTRAINT "slack_teammate_invitation_onboarding_shape_check" CHECK((
        ("status" <> 'delivered'
          AND "onboarding_status" IS NULL
          AND "joined_user_id" IS NULL
          AND "joined_profile_id" IS NULL
          AND "research_task_id" IS NULL
          AND "welcome_message_ts" IS NULL
          AND "onboarding_failure_code" IS NULL)
        OR ("status" = 'delivered' AND (
          ("onboarding_status" = 'waiting_for_join'
            AND "joined_user_id" IS NULL
            AND "joined_profile_id" IS NULL
            AND "research_task_id" IS NULL
            AND "welcome_message_ts" IS NULL
            AND "onboarding_failure_code" IS NULL)
          OR ("onboarding_status" = 'starting'
            AND length(trim("joined_user_id")) > 0
            AND length(trim("joined_profile_id")) > 0
            AND "research_task_id" IS NULL
            AND "welcome_message_ts" IS NULL
            AND "onboarding_failure_code" IS NULL)
          OR ("onboarding_status" = 'researching'
            AND length(trim("joined_user_id")) > 0
            AND length(trim("joined_profile_id")) > 0
            AND length(trim("research_task_id")) > 0
            AND "welcome_message_ts" IS NULL
            AND "onboarding_failure_code" IS NULL)
          OR ("onboarding_status" = 'completed'
            AND length(trim("joined_user_id")) > 0
            AND length(trim("joined_profile_id")) > 0
            AND length(trim("research_task_id")) > 0
            AND length(trim("welcome_message_ts")) > 0
            AND "onboarding_failure_code" IS NULL)
          OR ("onboarding_status" = 'failed'
            AND length(trim("joined_user_id")) > 0
            AND length(trim("joined_profile_id")) > 0
            AND length(trim("onboarding_failure_code")) > 0)
        ))
      )),
	CONSTRAINT "slack_teammate_invitation_time_check" CHECK("created_at_ms" > 0 AND "updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `idx_slack_teammate_invitation_status_updated` ON `slack_teammate_invitation_deliveries` (`status`,`updated_at_ms`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_organization_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_user_id` text,
	`profile_report_date` text,
	`profile_report_type` text,
	`folder_id` text,
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
	FOREIGN KEY (`folder_id`) REFERENCES `organization_document_folders`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "organization_documents_kind_check" CHECK("kind" in ('brief', 'member_profile', 'knowledge')),
	CONSTRAINT "organization_documents_subject_check" CHECK(("kind" = 'member_profile' and "subject_user_id" is not null) or ("kind" != 'member_profile' and "subject_user_id" is null)),
	CONSTRAINT "organization_documents_brief_title_check" CHECK("kind" != 'brief' or "title" = 'Organization Brief'),
	CONSTRAINT "organization_documents_title_check" CHECK(length(trim("title")) between 1 and 200),
	CONSTRAINT "organization_documents_content_length_check" CHECK(length("content") <= 20000),
	CONSTRAINT "organization_documents_draft_content_length_check" CHECK("draft_content" is null or length("draft_content") <= 20000),
	CONSTRAINT "organization_documents_draft_metadata_check" CHECK(("draft_content" is null and "draft_created_by" is null and "draft_created_at" is null) or ("draft_content" is not null and "draft_created_by" = 'center_agent' and "draft_created_at" is not null)),
	CONSTRAINT "organization_documents_member_research_check" CHECK("last_member_research_task_id" is null or "kind" = 'member_profile'),
	CONSTRAINT "organization_documents_profile_report_metadata_check" CHECK(("kind" != 'member_profile' and "profile_report_date" is null and "profile_report_type" is null) or ("kind" = 'member_profile' and (("profile_report_date" is null and "profile_report_type" is null) or (length("profile_report_date") = 10 and "profile_report_type" = 'work_profile')))),
	CONSTRAINT "organization_documents_updated_at_check" CHECK("updated_at" >= "created_at")
);
--> statement-breakpoint
INSERT INTO `__new_organization_documents`("id", "organization_id", "kind", "subject_user_id", "folder_id", "title", "content", "draft_content", "draft_created_by", "draft_created_at", "last_member_research_task_id", "created_at", "updated_at") SELECT "id", "organization_id", "kind", "subject_user_id", "folder_id", "title", "content", "draft_content", "draft_created_by", "draft_created_at", "last_member_research_task_id", "created_at", "updated_at" FROM `organization_documents`;--> statement-breakpoint
DROP TABLE `organization_documents`;--> statement-breakpoint
ALTER TABLE `__new_organization_documents` RENAME TO `organization_documents`;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_documents_org_brief_unique` ON `organization_documents` (`organization_id`) WHERE "kind" = 'brief';--> statement-breakpoint
CREATE INDEX `organization_documents_org_member_profile_date_idx` ON `organization_documents` (`organization_id`,`subject_user_id`,"profile_report_date" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_documents_profile_report_title_unique` ON `organization_documents` (`organization_id`,`subject_user_id`,`profile_report_date`,`profile_report_type`,`title`) WHERE "kind" = 'member_profile' and "profile_report_date" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_documents_member_research_task_unique` ON `organization_documents` (`last_member_research_task_id`) WHERE "last_member_research_task_id" is not null;--> statement-breakpoint
CREATE INDEX `organization_documents_org_kind_updated_idx` ON `organization_documents` (`organization_id`,`kind`,"updated_at" desc);--> statement-breakpoint
CREATE TABLE `__new_organization_document_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`parent_folder_id` text,
	`system_kind` text,
	`subject_user_id` text,
	`name` text NOT NULL,
	`name_key` text GENERATED ALWAYS AS (lower("name")) STORED,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_folder_id`) REFERENCES `organization_document_folders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_document_folders_name_check" CHECK(length(trim("name")) between 1 and 200),
	CONSTRAINT "organization_document_folders_updated_at_check" CHECK("updated_at" >= "created_at"),
	CONSTRAINT "organization_document_folders_parent_check" CHECK("parent_folder_id" is null or "parent_folder_id" != "id"),
	CONSTRAINT "organization_document_folders_system_kind_check" CHECK("system_kind" is null or "system_kind" in ('profile_reports_root', 'profile_reports_person')),
	CONSTRAINT "organization_document_folders_system_metadata_check" CHECK(("system_kind" is null and "subject_user_id" is null) or ("system_kind" = 'profile_reports_root' and "parent_folder_id" is null and "subject_user_id" is null) or ("system_kind" = 'profile_reports_person' and "parent_folder_id" is not null and "subject_user_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_organization_document_folders`("id", "organization_id", "parent_folder_id", "name", "created_at", "updated_at") SELECT "id", "organization_id", "parent_folder_id", "name", "created_at", "updated_at" FROM `organization_document_folders`;--> statement-breakpoint
DROP TABLE `organization_document_folders`;--> statement-breakpoint
ALTER TABLE `__new_organization_document_folders` RENAME TO `organization_document_folders`;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_document_folders_root_name_unique` ON `organization_document_folders` (`organization_id`,`name_key`) WHERE "organization_document_folders"."parent_folder_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_document_folders_sibling_name_unique` ON `organization_document_folders` (`organization_id`,`parent_folder_id`,`name_key`) WHERE "organization_document_folders"."parent_folder_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_document_folders_profile_reports_root_unique` ON `organization_document_folders` (`organization_id`,`system_kind`) WHERE "organization_document_folders"."system_kind" = 'profile_reports_root';--> statement-breakpoint
CREATE UNIQUE INDEX `organization_document_folders_profile_reports_person_unique` ON `organization_document_folders` (`organization_id`,`subject_user_id`) WHERE "organization_document_folders"."system_kind" = 'profile_reports_person';--> statement-breakpoint
CREATE INDEX `organization_document_folders_parent_name_idx` ON `organization_document_folders` (`organization_id`,`parent_folder_id`,`name`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
