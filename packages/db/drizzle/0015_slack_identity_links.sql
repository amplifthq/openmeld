CREATE TABLE `slack_user_identity_links` (
  `organization_id` text NOT NULL,
  `slack_team_id` text NOT NULL,
  `slack_user_id` text NOT NULL,
  `openmeld_user_id` text NOT NULL,
  `source` text NOT NULL,
  `created_at_ms` integer NOT NULL,
  CONSTRAINT `slack_user_identity_links_source_check` CHECK (`source` in ('explicit', 'email_auto')),
  CONSTRAINT `slack_user_identity_links_org_non_empty_check` CHECK (length(trim(`organization_id`)) > 0),
  CONSTRAINT `slack_user_identity_links_team_non_empty_check` CHECK (length(trim(`slack_team_id`)) > 0),
  CONSTRAINT `slack_user_identity_links_slack_user_non_empty_check` CHECK (length(trim(`slack_user_id`)) > 0),
  CONSTRAINT `slack_user_identity_links_openmeld_user_non_empty_check` CHECK (length(trim(`openmeld_user_id`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_user_identity_links_slack_user_unique` ON `slack_user_identity_links` (`slack_team_id`, `slack_user_id`);
--> statement-breakpoint
CREATE INDEX `idx_slack_user_identity_links_openmeld_user` ON `slack_user_identity_links` (`organization_id`, `openmeld_user_id`);
--> statement-breakpoint
CREATE TABLE `slack_user_identity_link_tokens` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `slack_team_id` text NOT NULL,
  `slack_user_id` text NOT NULL,
  `slack_user_display_name` text NOT NULL,
  `issued_at_ms` integer NOT NULL,
  `expires_at_ms` integer NOT NULL,
  `consumed_at_ms` integer,
  CONSTRAINT `slack_user_identity_link_tokens_hash_non_empty_check` CHECK (length(trim(`token_hash`)) > 0),
  CONSTRAINT `slack_user_identity_link_tokens_team_non_empty_check` CHECK (length(trim(`slack_team_id`)) > 0),
  CONSTRAINT `slack_user_identity_link_tokens_slack_user_non_empty_check` CHECK (length(trim(`slack_user_id`)) > 0),
  CONSTRAINT `slack_user_identity_link_tokens_display_name_non_empty_check` CHECK (length(trim(`slack_user_display_name`)) > 0),
  CONSTRAINT `slack_user_identity_link_tokens_expires_after_issued_check` CHECK (`expires_at_ms` > `issued_at_ms`),
  CONSTRAINT `slack_user_identity_link_tokens_consumed_after_issued_check` CHECK (`consumed_at_ms` IS NULL OR `consumed_at_ms` >= `issued_at_ms`)
);
--> statement-breakpoint
CREATE INDEX `idx_slack_user_identity_link_tokens_slack_user` ON `slack_user_identity_link_tokens` (`slack_team_id`, `slack_user_id`, `expires_at_ms`);
--> statement-breakpoint
CREATE INDEX `idx_slack_user_identity_link_tokens_expires_at` ON `slack_user_identity_link_tokens` (`expires_at_ms`);
