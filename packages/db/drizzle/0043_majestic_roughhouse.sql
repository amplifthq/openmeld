CREATE TABLE `slack_installation_welcome_deliveries` (
	`slack_team_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`recipient_slack_user_id` text NOT NULL,
	`connection_created_at_ms` integer NOT NULL,
	`welcome_version` integer NOT NULL,
	`message_kind` text NOT NULL,
	`status` text NOT NULL,
	`claim_id` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`message_ts` text,
	`failure_code` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`slack_team_id`, `organization_id`, `recipient_slack_user_id`, `connection_created_at_ms`, `welcome_version`),
	CONSTRAINT "slack_installation_welcome_team_non_empty_check" CHECK(length(trim("slack_team_id")) > 0),
	CONSTRAINT "slack_installation_welcome_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "slack_installation_welcome_recipient_non_empty_check" CHECK(length(trim("recipient_slack_user_id")) > 0),
	CONSTRAINT "slack_installation_welcome_connection_created_positive_check" CHECK("connection_created_at_ms" > 0),
	CONSTRAINT "slack_installation_welcome_version_positive_check" CHECK("welcome_version" > 0),
	CONSTRAINT "slack_installation_welcome_message_kind_check" CHECK("message_kind" in ('connected', 'moved')),
	CONSTRAINT "slack_installation_welcome_status_check" CHECK("status" in ('pending', 'delivered', 'failed', 'outcome_unknown')),
	CONSTRAINT "slack_installation_welcome_claim_non_empty_check" CHECK(length(trim("claim_id")) > 0),
	CONSTRAINT "slack_installation_welcome_attempt_count_positive_check" CHECK("attempt_count" > 0),
	CONSTRAINT "slack_installation_welcome_outcome_shape_check" CHECK((
        ("status" = 'pending' AND "message_ts" IS NULL AND "failure_code" IS NULL)
        OR (
          "status" = 'delivered'
          AND length(trim("message_ts")) > 0
          AND "failure_code" IS NULL
        )
        OR (
          "status" in ('failed', 'outcome_unknown')
          AND "message_ts" IS NULL
          AND length(trim("failure_code")) > 0
        )
      )),
	CONSTRAINT "slack_installation_welcome_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `idx_slack_installation_welcome_status_updated` ON `slack_installation_welcome_deliveries` (`status`,`updated_at_ms`);