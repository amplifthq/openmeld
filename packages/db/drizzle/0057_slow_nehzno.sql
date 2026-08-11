CREATE TABLE `openMeldRemoteAgent_lark_platform_channel_connections` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`app_id` text NOT NULL,
	`tenant_key` text,
	`bot_open_id` text,
	`bot_name` text,
	`transport` text NOT NULL,
	`status` text NOT NULL,
	`installed_by_user_id` text NOT NULL,
	`permission_bundle_version` text NOT NULL,
	`granted_capability_groups_json` text NOT NULL,
	`connection_generation` integer NOT NULL,
	`last_verified_at_ms` integer,
	`failure_reason_code` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "openMeldRemoteAgent_lark_platform_connections_provider_check" CHECK("provider" in ('lark', 'feishu')),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_connections_transport_check" CHECK("transport" in ('webhook', 'websocket')),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_connections_status_check" CHECK("status" in (
  'pending_registration',
  'credentials_received',
  'configuring',
  'connected',
  'repair_required',
  'revoked',
  'disconnected'
)),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_connections_identity_check" CHECK(length(trim("connection_id")) > 0
        and length(trim("organization_id")) > 0
        and length(trim("app_id")) > 0
        and length(trim("installed_by_user_id")) > 0),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_connections_bundle_check" CHECK(length(trim("permission_bundle_version")) > 0
        and length(trim("granted_capability_groups_json")) > 0),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_connections_generation_check" CHECK("connection_generation" > 0),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_connections_timestamps_check" CHECK("created_at_ms" >= 0
        and "updated_at_ms" >= "created_at_ms"
        and ("last_verified_at_ms" is null or "last_verified_at_ms" >= "created_at_ms"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_lark_platform_connections_org_provider_unique` ON `openMeldRemoteAgent_lark_platform_channel_connections` (`organization_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_lark_platform_connections_provider_app_unique` ON `openMeldRemoteAgent_lark_platform_channel_connections` (`provider`,`app_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_lark_platform_connections_org_status` ON `openMeldRemoteAgent_lark_platform_channel_connections` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `openMeldRemoteAgent_lark_platform_channel_credentials` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`encrypted_app_secret` text NOT NULL,
	`encrypted_verification_token` text,
	`encrypted_event_encrypt_key` text,
	`credential_format_version` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `openMeldRemoteAgent_lark_platform_channel_connections`(`connection_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "openMeldRemoteAgent_lark_platform_credentials_secret_check" CHECK(length(trim("encrypted_app_secret")) > 0),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_credentials_version_check" CHECK("credential_format_version" > 0),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_credentials_updated_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE TABLE `openMeldRemoteAgent_lark_platform_context_cursors` (
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`root_message_id` text NOT NULL,
	`connection_generation` integer NOT NULL,
	`synced_through_message_id` text NOT NULL,
	`synced_through_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `connection_id`, `chat_id`, `root_message_id`, `connection_generation`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `openMeldRemoteAgent_lark_platform_channel_connections`(`connection_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "openMeldRemoteAgent_lark_platform_context_cursors_provider_check" CHECK("provider" in ('lark', 'feishu')),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_context_cursors_identity_check" CHECK(length(trim("organization_id")) > 0
        and length(trim("connection_id")) > 0
        and length(trim("chat_id")) > 0
        and length(trim("root_message_id")) > 0
        and length(trim("synced_through_message_id")) > 0),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_context_cursors_generation_check" CHECK("connection_generation" > 0),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_context_cursors_timestamps_check" CHECK("synced_through_at_ms" >= 0
        and "created_at_ms" >= 0
        and "updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE TABLE `openMeldRemoteAgent_lark_platform_identity_links` (
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`openmeld_user_id` text NOT NULL,
	`resolution_source` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	PRIMARY KEY(`provider`, `connection_id`, `provider_user_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `openMeldRemoteAgent_lark_platform_channel_connections`(`connection_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`openmeld_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "openMeldRemoteAgent_lark_platform_identity_links_provider_check" CHECK("provider" in ('lark', 'feishu')),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_identity_links_source_check" CHECK("resolution_source" in ('installer', 'explicit', 'email_auto')),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_identity_links_identity_check" CHECK(length(trim("connection_id")) > 0
        and length(trim("provider_user_id")) > 0
        and length(trim("organization_id")) > 0
        and length(trim("openmeld_user_id")) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_lark_platform_identity_links_user` ON `openMeldRemoteAgent_lark_platform_identity_links` (`organization_id`,`openmeld_user_id`);--> statement-breakpoint
CREATE TABLE `openMeldRemoteAgent_lark_platform_registration_attempts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`initiated_by_user_id` text NOT NULL,
	`initiated_by_profile_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_device_code` text NOT NULL,
	`encrypted_registration_url` text NOT NULL,
	`account_domain` text NOT NULL,
	`detected_brand` text,
	`connection_id` text,
	`poll_interval_ms` integer NOT NULL,
	`next_poll_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`poll_claim_id` text,
	`poll_claim_expires_at_ms` integer,
	`permission_mode` text NOT NULL,
	`permission_bundle_version` text NOT NULL,
	`return_path` text NOT NULL,
	`status` text NOT NULL,
	`failure_reason_code` text,
	`consumed_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "openMeldRemoteAgent_lark_platform_registration_provider_check" CHECK("provider" in ('lark', 'feishu')),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_registration_detected_brand_check" CHECK("detected_brand" is null or "detected_brand" in ('lark', 'feishu')),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_registration_permission_mode_check" CHECK("permission_mode" in ('channel_only_template', 'official_preset')),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_registration_status_check" CHECK("status" in (
  'pending_registration',
  'credentials_received',
  'configuring',
  'connected',
  'repair_required',
  'revoked',
  'disconnected'
)),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_registration_identity_check" CHECK(length(trim("attempt_id")) > 0
        and length(trim("organization_id")) > 0
        and length(trim("initiated_by_user_id")) > 0
        and length(trim("initiated_by_profile_id")) > 0
        and length(trim("encrypted_device_code")) > 0
        and length(trim("encrypted_registration_url")) > 0
        and length(trim("account_domain")) > 0
        and ("connection_id" is null or length(trim("connection_id")) > 0)
        and length(trim("permission_bundle_version")) > 0
        and length(trim("return_path")) > 0),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_registration_poll_check" CHECK("poll_interval_ms" > 0
        and "next_poll_at_ms" >= "created_at_ms"
        and "next_poll_at_ms" <= "expires_at_ms"
        and "expires_at_ms" > "created_at_ms"),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_registration_claim_check" CHECK(("poll_claim_id" is null and "poll_claim_expires_at_ms" is null)
        or (
          length(trim("poll_claim_id")) > 0
          and "poll_claim_expires_at_ms" is not null
          and "poll_claim_expires_at_ms" > "updated_at_ms"
        )),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_registration_consumed_check" CHECK("consumed_at_ms" is null
        or (
          "status" in ('connected', 'repair_required', 'revoked', 'disconnected')
          and "consumed_at_ms" >= "created_at_ms"
        )),
	CONSTRAINT "openMeldRemoteAgent_lark_platform_registration_updated_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_lark_platform_registration_active_org_provider_unique` ON `openMeldRemoteAgent_lark_platform_registration_attempts` (`organization_id`,`provider`) WHERE "consumed_at_ms" is null
          and "status" in ('pending_registration', 'credentials_received', 'configuring');--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_lark_platform_registration_poll_due` ON `openMeldRemoteAgent_lark_platform_registration_attempts` (`status`,`next_poll_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_lark_platform_registration_expiry` ON `openMeldRemoteAgent_lark_platform_registration_attempts` (`expires_at_ms`);--> statement-breakpoint
CREATE TABLE `openMeldRemoteAgent_message_channel_event_ingress` (
	`event_key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`claim_id` text,
	`claim_expires_at_ms` integer,
	`first_received_at_ms` integer NOT NULL,
	`last_received_at_ms` integer NOT NULL,
	`delivery_attempt_count` integer DEFAULT 0 NOT NULL,
	`provider_retry_sequence` integer,
	`retry_reason_code` text,
	`gateway_request_id` text NOT NULL,
	`queue_message_id` text,
	`queue_attempts` integer,
	`native_delivery_id` text,
	`outcome_status` text,
	`failure_reason_code` text,
	`completed_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldRemoteAgent_message_channel_ingress_provider_check" CHECK("provider" in ('slack', 'lark', 'feishu')),
	CONSTRAINT "openMeldRemoteAgent_message_channel_ingress_state_check" CHECK("state" in ('queued', 'processing', 'completed', 'failed')),
	CONSTRAINT "openMeldRemoteAgent_message_channel_ingress_identity_check" CHECK(length(trim("event_key")) > 0
        and length(trim("connection_id")) > 0
        and length(trim("provider_event_id")) > 0
        and length(trim("gateway_request_id")) > 0),
	CONSTRAINT "openMeldRemoteAgent_message_channel_ingress_attempts_check" CHECK("delivery_attempt_count" >= 0
        and ("provider_retry_sequence" is null or "provider_retry_sequence" >= 0)
        and ("queue_attempts" is null or "queue_attempts" >= 0)),
	CONSTRAINT "openMeldRemoteAgent_message_channel_ingress_timestamps_check" CHECK("first_received_at_ms" >= 0
        and "last_received_at_ms" >= "first_received_at_ms"
        and "updated_at_ms" >= "first_received_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_message_channel_ingress_event_unique` ON `openMeldRemoteAgent_message_channel_event_ingress` (`provider`,`connection_id`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_message_channel_ingress_state_claim` ON `openMeldRemoteAgent_message_channel_event_ingress` (`state`,`claim_expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_message_channel_ingress_connection_received` ON `openMeldRemoteAgent_message_channel_event_ingress` (`provider`,`connection_id`,"last_received_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_message_channel_ingress_delivery` ON `openMeldRemoteAgent_message_channel_event_ingress` (`native_delivery_id`);--> statement-breakpoint
CREATE TABLE `openMeldRemoteAgent_message_channel_identity_link_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`provider_user_display_name` text NOT NULL,
	`organization_id` text NOT NULL,
	`issued_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`consumed_at_ms` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `openMeldRemoteAgent_lark_platform_channel_connections`(`connection_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_channel_identity_link_tokens_provider_check" CHECK("provider" in ('lark', 'feishu')),
	CONSTRAINT "message_channel_identity_link_tokens_identity_check" CHECK(length(trim("token_hash")) > 0
        and length(trim("connection_id")) > 0
        and length(trim("provider_user_id")) > 0
        and length(trim("provider_user_display_name")) > 0
        and length(trim("organization_id")) > 0),
	CONSTRAINT "message_channel_identity_link_tokens_expiry_check" CHECK("issued_at_ms" >= 0 and "expires_at_ms" > "issued_at_ms"),
	CONSTRAINT "message_channel_identity_link_tokens_consumed_check" CHECK("consumed_at_ms" is null or (
        "consumed_at_ms" >= "issued_at_ms"
        and "consumed_at_ms" < "expires_at_ms"
      ))
);
--> statement-breakpoint
CREATE INDEX `idx_message_channel_identity_link_tokens_external_user` ON `openMeldRemoteAgent_message_channel_identity_link_tokens` (`provider`,`connection_id`,`provider_user_id`,`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_message_channel_identity_link_tokens_expires_at` ON `openMeldRemoteAgent_message_channel_identity_link_tokens` (`expires_at_ms`);--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `message_channel_provider` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `message_channel_connection_id` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `message_channel_locator_json` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_publication_idempotency_key` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_publication_result_id` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_state` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_claim_id` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_claimed_at_ms` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_claim_expires_at_ms` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_card_id` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_message_id` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_publication_idempotency_key` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_sequence` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_pending_sequence` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_source_offset` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_rollover_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_pending_source_offset` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_pending_text_hash` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_pending_card_id` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `provider_progress_failure_code` text;--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_native_delivery_message_channel` ON `openMeldRemoteAgent_native_delivery_ledger` (`message_channel_provider`,`message_channel_connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_native_delivery_provider_publication_key_unique` ON `openMeldRemoteAgent_native_delivery_ledger` (`provider_publication_idempotency_key`);