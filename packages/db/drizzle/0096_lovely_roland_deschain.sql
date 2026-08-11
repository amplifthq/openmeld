PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	CONSTRAINT "message_channel_identity_link_tokens_continuation_check" CHECK("continuation_attempt" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_openMeldRemoteAgent_message_channel_identity_link_tokens`("token_hash", "provider", "connection_id", "provider_user_id", "provider_user_display_name", "organization_id", "source_delivery_id", "link_purpose", "issued_at_ms", "expires_at_ms", "claimed_by_user_id", "claimed_at_ms", "consumed_at_ms", "continuation_attempt") SELECT token."token_hash", token."provider", token."connection_id", token."provider_user_id", token."provider_user_display_name", token."organization_id", 'legacy:' || token."token_hash", 'optional_setup', token."issued_at_ms", token."expires_at_ms", CASE WHEN token."consumed_at_ms" IS NULL THEN NULL ELSE link."openmeld_user_id" END, CASE WHEN token."consumed_at_ms" IS NULL THEN NULL ELSE token."consumed_at_ms" END, token."consumed_at_ms", 0 FROM `openMeldRemoteAgent_message_channel_identity_link_tokens` AS token LEFT JOIN `openMeldRemoteAgent_lark_platform_identity_links` AS link ON link."provider" = token."provider" AND link."connection_id" = token."connection_id" AND link."provider_user_id" = token."provider_user_id" WHERE token."consumed_at_ms" IS NULL OR link."openmeld_user_id" IS NOT NULL;--> statement-breakpoint
DROP TABLE `openMeldRemoteAgent_message_channel_identity_link_tokens`;--> statement-breakpoint
ALTER TABLE `__new_openMeldRemoteAgent_message_channel_identity_link_tokens` RENAME TO `openMeldRemoteAgent_message_channel_identity_link_tokens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_message_channel_identity_link_tokens_external_user` ON `openMeldRemoteAgent_message_channel_identity_link_tokens` (`provider`,`connection_id`,`provider_user_id`,`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_message_channel_identity_link_tokens_expires_at` ON `openMeldRemoteAgent_message_channel_identity_link_tokens` (`expires_at_ms`);--> statement-breakpoint
CREATE TABLE `__new_center_agent_connector_action_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`requester_attribution_key` text NOT NULL,
	`represented_user_id` text,
	`source_native_delivery_id` text,
	`operation_id` text NOT NULL,
	`request_signature` text NOT NULL,
	`service` text NOT NULL,
	`action_id` text NOT NULL,
	`connection_name` text NOT NULL,
	`connection_owner_display_name` text,
	`connection_owner_user_id` text,
	`connection_scope` text,
	`status` text NOT NULL,
	`provider_execution_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`represented_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_connector_action_operations_requester_attribution_check" CHECK((
        "represented_user_id" is not null
        and "source_native_delivery_id" is null
        and "requester_attribution_key" = 'user:' || "represented_user_id"
      ) or (
        "represented_user_id" is null
        and "source_native_delivery_id" is not null
        and "requester_attribution_key" = 'delivery:' || "source_native_delivery_id"
      )),
	CONSTRAINT "center_agent_connector_action_operations_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "center_agent_connector_action_operations_operation_id_non_empty_check" CHECK(length(trim("operation_id")) > 0),
	CONSTRAINT "center_agent_connector_action_operations_signature_shape_check" CHECK(length("request_signature") = 64
        and "request_signature" not glob '*[^0-9a-f]*'),
	CONSTRAINT "center_agent_connector_action_operations_service_non_empty_check" CHECK(length(trim("service")) > 0),
	CONSTRAINT "center_agent_connector_action_operations_action_non_empty_check" CHECK(length(trim("action_id")) > 0),
	CONSTRAINT "center_agent_connector_action_operations_connection_non_empty_check" CHECK(length(trim("connection_name")) > 0),
	CONSTRAINT "center_agent_connector_action_operations_connection_snapshot_check" CHECK((
        "connection_owner_display_name" is null
        and "connection_owner_user_id" is null
        and "connection_scope" is null
      ) or (
        "connection_owner_display_name" is not null
        and "connection_owner_user_id" is not null
        and "connection_scope" is not null
        and
        length(trim("connection_owner_display_name")) > 0
        and length(trim("connection_owner_user_id")) > 0
        and "connection_scope" in ('member', 'shared')
      )),
	CONSTRAINT "center_agent_connector_action_operations_status_check" CHECK("status" in ('pending', 'completed', 'failed', 'outcome_unknown')),
	CONSTRAINT "center_agent_connector_action_operations_pending_evidence_check" CHECK("status" != 'pending' or "provider_execution_id" is null),
	CONSTRAINT "center_agent_connector_action_operations_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_center_agent_connector_action_operations`("id", "organization_id", "actor_profile_id", "requester_attribution_key", "represented_user_id", "source_native_delivery_id", "operation_id", "request_signature", "service", "action_id", "connection_name", "connection_owner_display_name", "connection_owner_user_id", "connection_scope", "status", "provider_execution_id", "created_at_ms", "updated_at_ms") SELECT "id", "organization_id", "actor_profile_id", 'user:' || "represented_user_id", "represented_user_id", NULL, "operation_id", "request_signature", "service", "action_id", "connection_name", "connection_owner_display_name", "connection_owner_user_id", "connection_scope", "status", "provider_execution_id", "created_at_ms", "updated_at_ms" FROM `center_agent_connector_action_operations`;--> statement-breakpoint
DROP TABLE `center_agent_connector_action_operations`;--> statement-breakpoint
ALTER TABLE `__new_center_agent_connector_action_operations` RENAME TO `center_agent_connector_action_operations`;--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_connector_action_operations_scope_unique` ON `center_agent_connector_action_operations` (`organization_id`,`actor_profile_id`,`requester_attribution_key`,`operation_id`);--> statement-breakpoint
CREATE INDEX `center_agent_connector_action_operations_org_updated_idx` ON `center_agent_connector_action_operations` (`organization_id`,`updated_at_ms`);
