ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `conversation_kind` text DEFAULT 'space' NOT NULL;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `slack_team_id` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `slack_channel_id` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `slack_thread_ts` text;--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_native_delivery_slack_thread` ON `openMeldRemoteAgent_native_delivery_ledger` (`slack_team_id`,`slack_channel_id`,`slack_thread_ts`);--> statement-breakpoint
CREATE TABLE `openMeldRemoteAgent_slack_workspace_bindings` (
	`slack_team_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldRemoteAgent_slack_workspace_team_non_empty_check" CHECK(length(trim("slack_team_id")) > 0),
	CONSTRAINT "openMeldRemoteAgent_slack_workspace_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "openMeldRemoteAgent_slack_workspace_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_slack_workspace_org_unique` ON `openMeldRemoteAgent_slack_workspace_bindings` (`organization_id`);
