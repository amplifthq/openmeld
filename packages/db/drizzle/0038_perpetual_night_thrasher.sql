CREATE TABLE `organization_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_user_id` text,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`draft_content` text,
	`draft_created_by` text,
	`draft_created_at` integer,
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
	CONSTRAINT "organization_documents_updated_at_check" CHECK("updated_at" >= "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_documents_org_brief_unique` ON `organization_documents` (`organization_id`) WHERE "kind" = 'brief';--> statement-breakpoint
CREATE UNIQUE INDEX `organization_documents_org_member_profile_unique` ON `organization_documents` (`organization_id`,`subject_user_id`) WHERE "kind" = 'member_profile';--> statement-breakpoint
CREATE INDEX `organization_documents_org_kind_updated_idx` ON `organization_documents` (`organization_id`,`kind`,"updated_at" desc);