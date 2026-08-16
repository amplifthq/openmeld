PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_slack_workspace_tokens` (
	`slack_team_id` text PRIMARY KEY NOT NULL,
	`encrypted_bot_token` text NOT NULL,
	`bot_user_id` text NOT NULL,
	`granted_bot_scopes` text,
	`installed_by_user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "slack_workspace_tokens_team_non_empty_check" CHECK(length(trim("slack_team_id")) > 0),
	CONSTRAINT "slack_workspace_tokens_token_non_empty_check" CHECK(length(trim("encrypted_bot_token")) > 0),
	CONSTRAINT "slack_workspace_tokens_bot_user_non_empty_check" CHECK(length(trim("bot_user_id")) > 0),
	CONSTRAINT "slack_workspace_tokens_scopes_non_empty_check" CHECK("granted_bot_scopes" IS NULL OR length(trim("granted_bot_scopes")) > 0),
	CONSTRAINT "slack_workspace_tokens_installer_non_empty_check" CHECK(length(trim("installed_by_user_id")) > 0),
	CONSTRAINT "slack_workspace_tokens_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "slack_workspace_tokens_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_slack_workspace_tokens`("slack_team_id", "encrypted_bot_token", "bot_user_id", "installed_by_user_id", "organization_id", "created_at_ms", "updated_at_ms") SELECT "slack_team_id", "encrypted_bot_token", "bot_user_id", "installed_by_user_id", "organization_id", "created_at_ms", "updated_at_ms" FROM `slack_workspace_tokens`;--> statement-breakpoint
DROP TABLE `slack_workspace_tokens`;--> statement-breakpoint
ALTER TABLE `__new_slack_workspace_tokens` RENAME TO `slack_workspace_tokens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `slack_workspace_tokens_org_unique` ON `slack_workspace_tokens` (`organization_id`);
