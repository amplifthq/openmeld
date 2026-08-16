PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_slack_invited_member_welcome_deliveries` (
	`interaction_id` text NOT NULL,
	`target_slack_user_id` text NOT NULL,
	`research_task_id` text,
	`status` text NOT NULL,
	`claim_id` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`message_ts` text,
	`failure_code` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`interaction_id`, `target_slack_user_id`),
	CONSTRAINT "slack_invited_member_welcome_identity_check" CHECK(length(trim("interaction_id")) > 0
        AND length(trim("target_slack_user_id")) > 0
        AND ("research_task_id" IS NULL OR length(trim("research_task_id")) > 0)
        AND length(trim("claim_id")) > 0),
	CONSTRAINT "slack_invited_member_welcome_status_check" CHECK("status" in ('pending', 'delivered', 'failed', 'outcome_unknown')),
	CONSTRAINT "slack_invited_member_welcome_attempt_count_check" CHECK("attempt_count" > 0),
	CONSTRAINT "slack_invited_member_welcome_outcome_shape_check" CHECK((
        ("status" = 'pending' AND "message_ts" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'delivered' AND length(trim("message_ts")) > 0 AND "failure_code" IS NULL)
        OR ("status" IN ('failed', 'outcome_unknown') AND "message_ts" IS NULL AND length(trim("failure_code")) > 0)
      )),
	CONSTRAINT "slack_invited_member_welcome_time_check" CHECK("created_at_ms" > 0 AND "updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_slack_invited_member_welcome_deliveries`("interaction_id", "target_slack_user_id", "research_task_id", "status", "claim_id", "attempt_count", "message_ts", "failure_code", "created_at_ms", "updated_at_ms") SELECT "interaction_id", "target_slack_user_id", "research_task_id", "status", "claim_id", "attempt_count", "message_ts", "failure_code", "created_at_ms", "updated_at_ms" FROM `slack_invited_member_welcome_deliveries`;--> statement-breakpoint
DROP TABLE `slack_invited_member_welcome_deliveries`;--> statement-breakpoint
ALTER TABLE `__new_slack_invited_member_welcome_deliveries` RENAME TO `slack_invited_member_welcome_deliveries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_slack_invited_member_welcome_status_updated` ON `slack_invited_member_welcome_deliveries` (`status`,`updated_at_ms`);