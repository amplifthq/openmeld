PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_slack_channel_introduction_runs` (
	`interaction_id` text PRIMARY KEY NOT NULL,
	`manifest_creation_id` text NOT NULL,
	`slack_team_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`requester_slack_user_id` text NOT NULL,
	`dm_channel_id` text NOT NULL,
	`organization_invite_url` text,
	`status` text NOT NULL,
	`acknowledgement_ts` text,
	`recovery_notice_ts` text,
	`recovery_notice_attempt_count` integer DEFAULT 0 NOT NULL,
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
	CONSTRAINT "slack_channel_introduction_runs_status_check" CHECK("status" in ('ack_pending', 'ready', 'failed', 'outcome_unknown', 'recovery_notice_pending', 'recovery_notice_submitting', 'recovery_notice_delivered', 'recovery_notice_failed', 'recovery_notice_outcome_unknown')),
	CONSTRAINT "slack_channel_introduction_runs_outcome_shape_check" CHECK((
        "recovery_notice_attempt_count" >= 0
        AND (
          ("status" = 'ack_pending' AND "acknowledgement_ts" IS NULL AND "recovery_notice_ts" IS NULL AND "failure_code" IS NULL)
          OR ("status" = 'ready' AND length(trim("acknowledgement_ts")) > 0 AND "recovery_notice_ts" IS NULL AND "failure_code" IS NULL)
          OR ("status" IN ('failed', 'outcome_unknown') AND "acknowledgement_ts" IS NULL AND "recovery_notice_ts" IS NULL AND length(trim("failure_code")) > 0)
          OR ("status" IN ('recovery_notice_pending', 'recovery_notice_submitting', 'recovery_notice_failed', 'recovery_notice_outcome_unknown') AND "acknowledgement_ts" IS NULL AND "recovery_notice_ts" IS NULL AND length(trim("failure_code")) > 0)
          OR ("status" = 'recovery_notice_delivered' AND "acknowledgement_ts" IS NULL AND length(trim("recovery_notice_ts")) > 0 AND length(trim("failure_code")) > 0)
        )
      )),
	CONSTRAINT "slack_channel_introduction_runs_time_check" CHECK("created_at_ms" > 0 AND "updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_slack_channel_introduction_runs`("interaction_id", "manifest_creation_id", "slack_team_id", "organization_id", "requester_slack_user_id", "dm_channel_id", "organization_invite_url", "status", "acknowledgement_ts", "recovery_notice_ts", "recovery_notice_attempt_count", "failure_code", "created_at_ms", "updated_at_ms") SELECT "interaction_id", "manifest_creation_id", "slack_team_id", "organization_id", "requester_slack_user_id", "dm_channel_id", "organization_invite_url", "status", "acknowledgement_ts", NULL, 0, "failure_code", "created_at_ms", "updated_at_ms" FROM `slack_channel_introduction_runs`;--> statement-breakpoint
DROP TABLE `slack_channel_introduction_runs`;--> statement-breakpoint
ALTER TABLE `__new_slack_channel_introduction_runs` RENAME TO `slack_channel_introduction_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_slack_channel_introduction_runs_status_updated` ON `slack_channel_introduction_runs` (`status`,`updated_at_ms`);
