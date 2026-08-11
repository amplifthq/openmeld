PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_slack_user_identity_link_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`slack_team_id` text NOT NULL,
	`slack_user_id` text NOT NULL,
	`slack_user_display_name` text NOT NULL,
	`issued_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`consumed_at_ms` integer,
	`consume_nonce` text,
	`consumed_by_user_id` text,
	`claimed_at_ms` integer,
	`claimed_by_user_id` text,
	`membership_requirement` text DEFAULT 'allow_enrollment' NOT NULL,
	`continuation_attempt` integer DEFAULT 0 NOT NULL,
	`delivery_scope` text,
	`source_delivery_id` text,
	CONSTRAINT "slack_user_identity_link_tokens_hash_non_empty_check" CHECK(length(trim("token_hash")) > 0),
	CONSTRAINT "slack_user_identity_link_tokens_team_non_empty_check" CHECK(length(trim("slack_team_id")) > 0),
	CONSTRAINT "slack_user_identity_link_tokens_slack_user_non_empty_check" CHECK(length(trim("slack_user_id")) > 0),
	CONSTRAINT "slack_user_identity_link_tokens_display_name_non_empty_check" CHECK(length(trim("slack_user_display_name")) > 0),
	CONSTRAINT "slack_user_identity_link_tokens_expires_after_issued_check" CHECK("expires_at_ms" > "issued_at_ms"),
	CONSTRAINT "slack_user_identity_link_tokens_consumed_after_issued_check" CHECK("consumed_at_ms" IS NULL OR "consumed_at_ms" >= "issued_at_ms"),
	CONSTRAINT "slack_user_identity_link_tokens_membership_requirement_check" CHECK("membership_requirement" in ('allow_enrollment', 'current_member'))
);
--> statement-breakpoint
INSERT INTO `__new_slack_user_identity_link_tokens`("token_hash", "organization_id", "slack_team_id", "slack_user_id", "slack_user_display_name", "issued_at_ms", "expires_at_ms", "consumed_at_ms", "consume_nonce", "consumed_by_user_id", "claimed_at_ms", "claimed_by_user_id", "membership_requirement", "continuation_attempt", "delivery_scope", "source_delivery_id") SELECT "token_hash", "organization_id", "slack_team_id", "slack_user_id", "slack_user_display_name", "issued_at_ms", "expires_at_ms", "consumed_at_ms", "consume_nonce", "consumed_by_user_id", "claimed_at_ms", "claimed_by_user_id", 'allow_enrollment', "continuation_attempt", "delivery_scope", "source_delivery_id" FROM `slack_user_identity_link_tokens`;--> statement-breakpoint
DROP TABLE `slack_user_identity_link_tokens`;--> statement-breakpoint
ALTER TABLE `__new_slack_user_identity_link_tokens` RENAME TO `slack_user_identity_link_tokens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_slack_user_identity_link_tokens_slack_user` ON `slack_user_identity_link_tokens` (`slack_team_id`,`slack_user_id`,`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_slack_user_identity_link_tokens_expires_at` ON `slack_user_identity_link_tokens` (`expires_at_ms`);--> statement-breakpoint
CREATE TABLE `__new_openMeldRemoteAgent_message_channel_identity_link_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`provider_user_display_name` text NOT NULL,
	`organization_id` text NOT NULL,
	`source_delivery_id` text NOT NULL,
	`link_purpose` text NOT NULL,
	`issued_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`claimed_by_user_id` text,
	`claimed_at_ms` integer,
	`membership_requirement` text DEFAULT 'allow_enrollment' NOT NULL,
	`consumed_at_ms` integer,
	`continuation_attempt` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `openMeldRemoteAgent_lark_platform_channel_connections`(`connection_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_channel_identity_link_tokens_provider_check" CHECK("provider" in ('lark', 'feishu')),
	CONSTRAINT "message_channel_identity_link_tokens_identity_check" CHECK(length(trim("token_hash")) > 0
        and length(trim("connection_id")) > 0
        and length(trim("provider_user_id")) > 0
        and length(trim("provider_user_display_name")) > 0
        and length(trim("organization_id")) > 0
        and length(trim("source_delivery_id")) > 0),
	CONSTRAINT "message_channel_identity_link_tokens_purpose_check" CHECK("link_purpose" in ('continue_request', 'optional_setup')),
	CONSTRAINT "message_channel_identity_link_tokens_expiry_check" CHECK("issued_at_ms" >= 0 and "expires_at_ms" > "issued_at_ms"),
	CONSTRAINT "message_channel_identity_link_tokens_claim_check" CHECK(("claimed_by_user_id" is null and "claimed_at_ms" is null) or (
        length(trim("claimed_by_user_id")) > 0
        and "claimed_at_ms" >= "issued_at_ms"
        and "claimed_at_ms" < "expires_at_ms"
      )),
	CONSTRAINT "message_channel_identity_link_tokens_consumed_check" CHECK("consumed_at_ms" is null or (
        "claimed_by_user_id" is not null
        and "consumed_at_ms" >= "issued_at_ms"
        and "consumed_at_ms" < "expires_at_ms"
      )),
	CONSTRAINT "message_channel_identity_link_tokens_membership_requirement_check" CHECK("membership_requirement" in ('allow_enrollment', 'current_member')),
	CONSTRAINT "message_channel_identity_link_tokens_continuation_check" CHECK("continuation_attempt" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_openMeldRemoteAgent_message_channel_identity_link_tokens`("token_hash", "provider", "connection_id", "provider_user_id", "provider_user_display_name", "organization_id", "source_delivery_id", "link_purpose", "issued_at_ms", "expires_at_ms", "claimed_by_user_id", "claimed_at_ms", "membership_requirement", "consumed_at_ms", "continuation_attempt") SELECT "token_hash", "provider", "connection_id", "provider_user_id", "provider_user_display_name", "organization_id", "source_delivery_id", "link_purpose", "issued_at_ms", "expires_at_ms", "claimed_by_user_id", "claimed_at_ms", 'allow_enrollment', "consumed_at_ms", "continuation_attempt" FROM `openMeldRemoteAgent_message_channel_identity_link_tokens`;--> statement-breakpoint
DROP TABLE `openMeldRemoteAgent_message_channel_identity_link_tokens`;--> statement-breakpoint
ALTER TABLE `__new_openMeldRemoteAgent_message_channel_identity_link_tokens` RENAME TO `openMeldRemoteAgent_message_channel_identity_link_tokens`;--> statement-breakpoint
CREATE INDEX `idx_message_channel_identity_link_tokens_external_user` ON `openMeldRemoteAgent_message_channel_identity_link_tokens` (`provider`,`connection_id`,`provider_user_id`,`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_message_channel_identity_link_tokens_expires_at` ON `openMeldRemoteAgent_message_channel_identity_link_tokens` (`expires_at_ms`);
