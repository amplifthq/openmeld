CREATE TABLE `openMeldFeedback_inboxes` (
	`inbox_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`label` text NOT NULL,
	`inbox_key` text NOT NULL,
	`delivery_mode` text NOT NULL,
	`status` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldFeedback_inboxes_inbox_key_unique` ON `openMeldFeedback_inboxes` (`inbox_key`);--> statement-breakpoint
CREATE TABLE `openMeldFeedback_issues` (
	`issue_id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`category` text NOT NULL,
	`summary` text NOT NULL,
	`details` text,
	`submitter_kind` text NOT NULL,
	`submitter_user_id` text,
	`source_organization_id` text,
	`contact_email` text,
	`client_context` text,
	`status` text DEFAULT 'new' NOT NULL,
	`triage_note` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldFeedback_issues_inbox_status_created` ON `openMeldFeedback_issues` (`inbox_id`,`status`,"created_at_ms" desc);
