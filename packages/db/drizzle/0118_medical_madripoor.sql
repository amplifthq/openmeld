CREATE TABLE `slack_channel_introduction_items` (
	`interaction_id` text NOT NULL,
	`slack_channel_id` text NOT NULL,
	`slack_channel_name` text NOT NULL,
	`position` integer NOT NULL,
	`bot_was_channel_member` integer NOT NULL,
	`status` text NOT NULL,
	`claim_id` text,
	`attempt_count` integer NOT NULL,
	`failure_code` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`interaction_id`, `slack_channel_id`),
	CONSTRAINT "slack_channel_introduction_items_identity_check" CHECK(length(trim("interaction_id")) > 0
        AND length(trim("slack_channel_id")) > 0
        AND length(trim("slack_channel_name")) > 0
        AND "position" >= 0),
	CONSTRAINT "slack_channel_introduction_items_status_check" CHECK("status" in ('ready', 'submitting', 'submitted', 'failed', 'outcome_unknown')),
	CONSTRAINT "slack_channel_introduction_items_attempt_count_check" CHECK("attempt_count" >= 0),
	CONSTRAINT "slack_channel_introduction_items_outcome_shape_check" CHECK((
        ("status" = 'ready' AND "claim_id" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'submitting' AND length(trim("claim_id")) > 0 AND "failure_code" IS NULL)
        OR ("status" = 'submitted' AND "claim_id" IS NULL AND "failure_code" IS NULL)
        OR ("status" IN ('failed', 'outcome_unknown') AND "claim_id" IS NULL AND length(trim("failure_code")) > 0)
      )),
	CONSTRAINT "slack_channel_introduction_items_time_check" CHECK("created_at_ms" > 0 AND "updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_channel_introduction_items_position_unique` ON `slack_channel_introduction_items` (`interaction_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_slack_channel_introduction_items_status_updated` ON `slack_channel_introduction_items` (`status`,`updated_at_ms`);--> statement-breakpoint
CREATE TABLE `slack_channel_introduction_runs` (
	`interaction_id` text PRIMARY KEY NOT NULL,
	`manifest_creation_id` text NOT NULL,
	`slack_team_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`requester_slack_user_id` text NOT NULL,
	`dm_channel_id` text NOT NULL,
	`organization_invite_url` text,
	`status` text NOT NULL,
	`acknowledgement_ts` text,
	`failure_code` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "slack_channel_introduction_runs_identity_check" CHECK(length(trim("interaction_id")) > 0
		AND length(trim("manifest_creation_id")) > 0
        AND length(trim("slack_team_id")) > 0
        AND length(trim("organization_id")) > 0
        AND length(trim("requester_slack_user_id")) > 0
        AND length(trim("dm_channel_id")) > 0
        AND ("organization_invite_url" IS NULL OR length(trim("organization_invite_url")) > 0)),
	CONSTRAINT "slack_channel_introduction_runs_status_check" CHECK("status" in ('ack_pending', 'ready', 'failed', 'outcome_unknown')),
	CONSTRAINT "slack_channel_introduction_runs_outcome_shape_check" CHECK((
        ("status" = 'ack_pending' AND "acknowledgement_ts" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'ready' AND length(trim("acknowledgement_ts")) > 0 AND "failure_code" IS NULL)
        OR ("status" IN ('failed', 'outcome_unknown') AND "acknowledgement_ts" IS NULL AND length(trim("failure_code")) > 0)
      )),
	CONSTRAINT "slack_channel_introduction_runs_time_check" CHECK("created_at_ms" > 0 AND "updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `idx_slack_channel_introduction_runs_status_updated` ON `slack_channel_introduction_runs` (`status`,`updated_at_ms`);
