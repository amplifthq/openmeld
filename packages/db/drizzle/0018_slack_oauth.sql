CREATE TABLE `slack_oauth_states` (
	`state_digest` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`return_path` text NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	CONSTRAINT "slack_oauth_states_digest_non_empty_check" CHECK(length(trim("state_digest")) > 0),
	CONSTRAINT "slack_oauth_states_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "slack_oauth_states_user_non_empty_check" CHECK(length(trim("user_id")) > 0),
	CONSTRAINT "slack_oauth_states_actor_non_empty_check" CHECK(length(trim("actor_profile_id")) > 0),
	CONSTRAINT "slack_oauth_states_return_path_check" CHECK(substr("return_path", 1, 1) = '/'),
	CONSTRAINT "slack_oauth_states_expiry_valid_check" CHECK("expires_at_ms" > "created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `idx_slack_oauth_states_expires` ON `slack_oauth_states` (`expires_at_ms`);--> statement-breakpoint
CREATE TABLE `slack_workspace_tokens` (
	`slack_team_id` text PRIMARY KEY NOT NULL,
	`encrypted_bot_token` text NOT NULL,
	`bot_user_id` text NOT NULL,
	`installed_by_user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "slack_workspace_tokens_team_non_empty_check" CHECK(length(trim("slack_team_id")) > 0),
	CONSTRAINT "slack_workspace_tokens_token_non_empty_check" CHECK(length(trim("encrypted_bot_token")) > 0),
	CONSTRAINT "slack_workspace_tokens_bot_user_non_empty_check" CHECK(length(trim("bot_user_id")) > 0),
	CONSTRAINT "slack_workspace_tokens_installer_non_empty_check" CHECK(length(trim("installed_by_user_id")) > 0),
	CONSTRAINT "slack_workspace_tokens_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "slack_workspace_tokens_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_workspace_tokens_org_unique` ON `slack_workspace_tokens` (`organization_id`);
