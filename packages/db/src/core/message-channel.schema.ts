import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

const messageChannelConnectionStatuses = sql`(
  'pending_registration',
  'credentials_received',
  'configuring',
  'connected',
  'repair_required',
  'revoked',
  'disconnected'
)`;

export const openMeldRemoteAgentLarkPlatformChannelConnections = sqliteTable(
  "openMeldRemoteAgent_lark_platform_channel_connections",
  {
    connectionId: text("connection_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["lark", "feishu"] }).notNull(),
    appId: text("app_id").notNull(),
    tenantKey: text("tenant_key"),
    botOpenId: text("bot_open_id"),
    botName: text("bot_name"),
    transport: text("transport", {
      enum: ["webhook", "websocket"],
    }).notNull(),
    status: text("status").notNull(),
    installedByUserId: text("installed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionBundleVersion: text("permission_bundle_version").notNull(),
    grantedCapabilityGroupsJson: text(
      "granted_capability_groups_json"
    ).notNull(),
    connectionGeneration: integer("connection_generation").notNull(),
    eventsWebhookVerifiedAtMs: integer("events_webhook_verified_at_ms"),
    callbacksWebhookVerifiedAtMs: integer("callbacks_webhook_verified_at_ms"),
    lastVerifiedAtMs: integer("last_verified_at_ms"),
    failureReasonCode: text("failure_reason_code"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex(
      "openMeldRemoteAgent_lark_platform_connections_org_provider_unique"
    ).on(table.organizationId, table.provider),
    uniqueIndex(
      "openMeldRemoteAgent_lark_platform_connections_provider_app_unique"
    ).on(table.provider, table.appId),
    index("idx_openMeldRemoteAgent_lark_platform_connections_org_status").on(
      table.organizationId,
      table.status
    ),
    check(
      "openMeldRemoteAgent_lark_platform_connections_provider_check",
      sql`"provider" in ('lark', 'feishu')`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_connections_transport_check",
      sql`"transport" in ('webhook', 'websocket')`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_connections_status_check",
      sql`"status" in ${messageChannelConnectionStatuses}`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_connections_identity_check",
      sql`length(trim("connection_id")) > 0
        and length(trim("organization_id")) > 0
        and length(trim("app_id")) > 0
        and length(trim("installed_by_user_id")) > 0`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_connections_bundle_check",
      sql`length(trim("permission_bundle_version")) > 0
        and length(trim("granted_capability_groups_json")) > 0`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_connections_generation_check",
      sql`"connection_generation" > 0`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_connections_timestamps_check",
      sql`"created_at_ms" >= 0
        and "updated_at_ms" >= "created_at_ms"
        and ("last_verified_at_ms" is null or "last_verified_at_ms" >= "created_at_ms")`
    ),
  ]
);

export const openMeldRemoteAgentLarkPlatformRegistrationAttempts = sqliteTable(
  "openMeldRemoteAgent_lark_platform_registration_attempts",
  {
    attemptId: text("attempt_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    initiatedByUserId: text("initiated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    initiatedByProfileId: text("initiated_by_profile_id").notNull(),
    provider: text("provider", { enum: ["lark", "feishu"] }).notNull(),
    encryptedDeviceCode: text("encrypted_device_code").notNull(),
    encryptedRegistrationUrl: text("encrypted_registration_url").notNull(),
    accountDomain: text("account_domain").notNull(),
    detectedBrand: text("detected_brand", {
      enum: ["lark", "feishu"],
    }),
    connectionId: text("connection_id"),
    pollIntervalMs: integer("poll_interval_ms").notNull(),
    nextPollAtMs: integer("next_poll_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    pollClaimId: text("poll_claim_id"),
    pollClaimExpiresAtMs: integer("poll_claim_expires_at_ms"),
    permissionMode: text("permission_mode", {
      enum: ["channel_only_template", "official_preset"],
    }).notNull(),
    permissionBundleVersion: text("permission_bundle_version").notNull(),
    returnPath: text("return_path").notNull(),
    status: text("status").notNull(),
    failureReasonCode: text("failure_reason_code"),
    consumedAtMs: integer("consumed_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex(
      "openMeldRemoteAgent_lark_platform_registration_active_org_provider_unique"
    )
      .on(table.organizationId, table.provider)
      .where(
        sql`"consumed_at_ms" is null
          and "status" in ('pending_registration', 'credentials_received', 'configuring')`
      ),
    index("idx_openMeldRemoteAgent_lark_platform_registration_poll_due").on(
      table.status,
      table.nextPollAtMs
    ),
    index("idx_openMeldRemoteAgent_lark_platform_registration_expiry").on(
      table.expiresAtMs
    ),
    check(
      "openMeldRemoteAgent_lark_platform_registration_provider_check",
      sql`"provider" in ('lark', 'feishu')`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_registration_detected_brand_check",
      sql`"detected_brand" is null or "detected_brand" in ('lark', 'feishu')`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_registration_permission_mode_check",
      sql`"permission_mode" in ('channel_only_template', 'official_preset')`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_registration_status_check",
      sql`"status" in ${messageChannelConnectionStatuses}`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_registration_identity_check",
      sql`length(trim("attempt_id")) > 0
        and length(trim("organization_id")) > 0
        and length(trim("initiated_by_user_id")) > 0
        and length(trim("initiated_by_profile_id")) > 0
        and length(trim("encrypted_device_code")) > 0
        and length(trim("encrypted_registration_url")) > 0
        and length(trim("account_domain")) > 0
        and ("connection_id" is null or length(trim("connection_id")) > 0)
        and length(trim("permission_bundle_version")) > 0
        and length(trim("return_path")) > 0`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_registration_poll_check",
      sql`"poll_interval_ms" > 0
        and "next_poll_at_ms" >= "created_at_ms"
        and "next_poll_at_ms" <= "expires_at_ms"
        and "expires_at_ms" > "created_at_ms"`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_registration_claim_check",
      sql`("poll_claim_id" is null and "poll_claim_expires_at_ms" is null)
        or (
          length(trim("poll_claim_id")) > 0
          and "poll_claim_expires_at_ms" is not null
          and "poll_claim_expires_at_ms" > "updated_at_ms"
        )`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_registration_consumed_check",
      sql`"consumed_at_ms" is null
        or (
          "status" in ('connected', 'repair_required', 'revoked', 'disconnected')
          and "consumed_at_ms" >= "created_at_ms"
        )`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_registration_updated_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const openMeldRemoteAgentLarkPlatformChannelCredentials = sqliteTable(
  "openMeldRemoteAgent_lark_platform_channel_credentials",
  {
    connectionId: text("connection_id")
      .primaryKey()
      .references(
        () => openMeldRemoteAgentLarkPlatformChannelConnections.connectionId,
        { onDelete: "cascade" }
      ),
    encryptedAppSecret: text("encrypted_app_secret").notNull(),
    encryptedVerificationToken: text("encrypted_verification_token"),
    encryptedEventEncryptKey: text("encrypted_event_encrypt_key"),
    credentialFormatVersion: integer("credential_format_version").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (_table) => [
    check(
      "openMeldRemoteAgent_lark_platform_credentials_secret_check",
      sql`length(trim("encrypted_app_secret")) > 0`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_credentials_version_check",
      sql`"credential_format_version" > 0`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_credentials_updated_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const openMeldRemoteAgentLarkPlatformIdentityLinks = sqliteTable(
  "openMeldRemoteAgent_lark_platform_identity_links",
  {
    provider: text("provider", { enum: ["lark", "feishu"] }).notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(
        () => openMeldRemoteAgentLarkPlatformChannelConnections.connectionId,
        { onDelete: "cascade" }
      ),
    providerUserId: text("provider_user_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    openmeldUserId: text("openmeld_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resolutionSource: text("resolution_source", {
      enum: ["installer", "explicit", "email_auto"],
    }).notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.connectionId, table.providerUserId],
      name: "openMeldRemoteAgent_lark_platform_identity_links_pk",
    }),
    index("idx_openMeldRemoteAgent_lark_platform_identity_links_user").on(
      table.organizationId,
      table.openmeldUserId
    ),
    check(
      "openMeldRemoteAgent_lark_platform_identity_links_provider_check",
      sql`"provider" in ('lark', 'feishu')`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_identity_links_source_check",
      sql`"resolution_source" in ('installer', 'explicit', 'email_auto')`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_identity_links_identity_check",
      sql`length(trim("connection_id")) > 0
        and length(trim("provider_user_id")) > 0
        and length(trim("organization_id")) > 0
        and length(trim("openmeld_user_id")) > 0`
    ),
  ]
);

export const openMeldRemoteAgentMessageChannelIdentityLinkTokens = sqliteTable(
  "openMeldRemoteAgent_message_channel_identity_link_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    provider: text("provider", { enum: ["lark", "feishu"] }).notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(
        () => openMeldRemoteAgentLarkPlatformChannelConnections.connectionId,
        { onDelete: "cascade" }
      ),
    providerUserId: text("provider_user_id").notNull(),
    providerUserDisplayName: text("provider_user_display_name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceDeliveryId: text("source_delivery_id").notNull(),
    linkPurpose: text("link_purpose", {
      enum: ["continue_request", "optional_setup"],
    }).notNull(),
    issuedAtMs: integer("issued_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    claimedByUserId: text("claimed_by_user_id"),
    claimedAtMs: integer("claimed_at_ms"),
    membershipRequirement: text("membership_requirement", {
      enum: ["allow_enrollment", "current_member"],
    })
      .notNull()
      .default("allow_enrollment"),
    consumedAtMs: integer("consumed_at_ms"),
    consumeNonce: text("consume_nonce"),
    continuationAttempt: integer("continuation_attempt").notNull().default(0),
  },
  (table) => [
    index("idx_message_channel_identity_link_tokens_external_user").on(
      table.provider,
      table.connectionId,
      table.providerUserId,
      table.expiresAtMs
    ),
    index("idx_message_channel_identity_link_tokens_expires_at").on(
      table.expiresAtMs
    ),
    check(
      "message_channel_identity_link_tokens_provider_check",
      sql`"provider" in ('lark', 'feishu')`
    ),
    check(
      "message_channel_identity_link_tokens_identity_check",
      sql`length(trim("token_hash")) > 0
        and length(trim("connection_id")) > 0
        and length(trim("provider_user_id")) > 0
        and length(trim("provider_user_display_name")) > 0
        and length(trim("organization_id")) > 0
        and length(trim("source_delivery_id")) > 0`
    ),
    check(
      "message_channel_identity_link_tokens_purpose_check",
      sql`"link_purpose" in ('continue_request', 'optional_setup')`
    ),
    check(
      "message_channel_identity_link_tokens_expiry_check",
      sql`"issued_at_ms" >= 0 and "expires_at_ms" > "issued_at_ms"`
    ),
    check(
      "message_channel_identity_link_tokens_claim_check",
      sql`("claimed_by_user_id" is null and "claimed_at_ms" is null) or (
        length(trim("claimed_by_user_id")) > 0
        and "claimed_at_ms" >= "issued_at_ms"
        and "claimed_at_ms" < "expires_at_ms"
      )`
    ),
    check(
      "message_channel_identity_link_tokens_consumed_check",
      sql`"consumed_at_ms" is null or (
        "claimed_by_user_id" is not null
        and "consumed_at_ms" >= "issued_at_ms"
        and "consumed_at_ms" < "expires_at_ms"
      )`
    ),
    check(
      "message_channel_identity_link_tokens_membership_requirement_check",
      sql`"membership_requirement" in ('allow_enrollment', 'current_member')`
    ),
    check(
      "message_channel_identity_link_tokens_continuation_check",
      sql`"continuation_attempt" >= 0`
    ),
  ]
);

export const openMeldRemoteAgentLarkPlatformContextCursors = sqliteTable(
  "openMeldRemoteAgent_lark_platform_context_cursors",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["lark", "feishu"] }).notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(
        () => openMeldRemoteAgentLarkPlatformChannelConnections.connectionId,
        { onDelete: "cascade" }
      ),
    chatId: text("chat_id").notNull(),
    rootMessageId: text("root_message_id").notNull(),
    connectionGeneration: integer("connection_generation").notNull(),
    syncedThroughMessageId: text("synced_through_message_id").notNull(),
    syncedThroughAtMs: integer("synced_through_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.connectionId,
        table.chatId,
        table.rootMessageId,
        table.connectionGeneration,
      ],
      name: "openMeldRemoteAgent_lark_platform_context_cursors_pk",
    }),
    check(
      "openMeldRemoteAgent_lark_platform_context_cursors_provider_check",
      sql`"provider" in ('lark', 'feishu')`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_context_cursors_identity_check",
      sql`length(trim("organization_id")) > 0
        and length(trim("connection_id")) > 0
        and length(trim("chat_id")) > 0
        and length(trim("root_message_id")) > 0
        and length(trim("synced_through_message_id")) > 0`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_context_cursors_generation_check",
      sql`"connection_generation" > 0`
    ),
    check(
      "openMeldRemoteAgent_lark_platform_context_cursors_timestamps_check",
      sql`"synced_through_at_ms" >= 0
        and "created_at_ms" >= 0
        and "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const openMeldRemoteAgentMessageChannelEventIngress = sqliteTable(
  "openMeldRemoteAgent_message_channel_event_ingress",
  {
    eventKey: text("event_key").primaryKey(),
    provider: text("provider", {
      enum: ["slack", "lark", "feishu"],
    }).notNull(),
    connectionId: text("connection_id").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    state: text("state", {
      enum: ["queued", "processing", "completed", "failed"],
    })
      .default("queued")
      .notNull(),
    claimId: text("claim_id"),
    claimExpiresAtMs: integer("claim_expires_at_ms"),
    firstReceivedAtMs: integer("first_received_at_ms").notNull(),
    lastReceivedAtMs: integer("last_received_at_ms").notNull(),
    deliveryAttemptCount: integer("delivery_attempt_count")
      .default(0)
      .notNull(),
    providerRetrySequence: integer("provider_retry_sequence"),
    retryReasonCode: text("retry_reason_code"),
    gatewayRequestId: text("gateway_request_id").notNull(),
    queueMessageId: text("queue_message_id"),
    queueAttempts: integer("queue_attempts"),
    nativeDeliveryId: text("native_delivery_id"),
    outcomeStatus: text("outcome_status"),
    failureReasonCode: text("failure_reason_code"),
    completedAtMs: integer("completed_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("openMeldRemoteAgent_message_channel_ingress_event_unique").on(
      table.provider,
      table.connectionId,
      table.providerEventId
    ),
    index("idx_openMeldRemoteAgent_message_channel_ingress_state_claim").on(
      table.state,
      table.claimExpiresAtMs
    ),
    index(
      "idx_openMeldRemoteAgent_message_channel_ingress_connection_received"
    ).on(table.provider, table.connectionId, desc(table.lastReceivedAtMs)),
    index("idx_openMeldRemoteAgent_message_channel_ingress_delivery").on(
      table.nativeDeliveryId
    ),
    check(
      "openMeldRemoteAgent_message_channel_ingress_provider_check",
      sql`"provider" in ('slack', 'lark', 'feishu')`
    ),
    check(
      "openMeldRemoteAgent_message_channel_ingress_state_check",
      sql`"state" in ('queued', 'processing', 'completed', 'failed')`
    ),
    check(
      "openMeldRemoteAgent_message_channel_ingress_identity_check",
      sql`length(trim("event_key")) > 0
        and length(trim("connection_id")) > 0
        and length(trim("provider_event_id")) > 0
        and length(trim("gateway_request_id")) > 0`
    ),
    check(
      "openMeldRemoteAgent_message_channel_ingress_attempts_check",
      sql`"delivery_attempt_count" >= 0
        and ("provider_retry_sequence" is null or "provider_retry_sequence" >= 0)
        and ("queue_attempts" is null or "queue_attempts" >= 0)`
    ),
    check(
      "openMeldRemoteAgent_message_channel_ingress_timestamps_check",
      sql`"first_received_at_ms" >= 0
        and "last_received_at_ms" >= "first_received_at_ms"
        and "updated_at_ms" >= "first_received_at_ms"`
    ),
  ]
);
