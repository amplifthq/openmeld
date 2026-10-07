import { desc, sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

const messageChannelConnectionStatuses = sql`(
  'pending_registration',
  'credentials_received',
  'configuring',
  'connected',
  'repair_required',
  'revoked',
  'disconnected'
)`;

export const organizationMessageChannelSetupRequests = applicationTable(
  "organization_message_channel_setup_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["slack", "lark", "feishu"],
    }).notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
    resolvedAtMs: bigint("resolved_at_ms", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("organization_message_channel_setup_requests_open_unique")
      .on(table.organizationId, table.requesterUserId, table.provider)
      .where(sql`${table.status} = 'open'`),
    index("organization_message_channel_setup_requests_resolution_idx").on(
      table.organizationId,
      table.provider,
      table.status
    ),
    check(
      "organization_message_channel_setup_requests_identity_check",
      sql`length(trim("id")) > 0 and length(trim("organization_id")) > 0 and length(trim("requester_user_id")) > 0`
    ),
    check(
      "organization_message_channel_setup_requests_provider_check",
      sql`"provider" in ('slack', 'lark', 'feishu')`
    ),
    check(
      "organization_message_channel_setup_requests_status_check",
      sql`("status" = 'open' and "resolved_at_ms" is null) or ("status" = 'resolved' and "resolved_at_ms" is not null)`
    ),
    check(
      "organization_message_channel_setup_requests_timestamps_check",
      sql`"created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("resolved_at_ms" is null or "resolved_at_ms" >= "created_at_ms")`
    ),
  ]
);

export const openMeldRemoteAgentLarkPlatformChannelConnections =
  applicationTable(
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
      connectionGeneration: bigint("connection_generation", {
        mode: "number",
      }).notNull(),
      eventsWebhookVerifiedAtMs: bigint("events_webhook_verified_at_ms", {
        mode: "number",
      }),
      callbacksWebhookVerifiedAtMs: bigint("callbacks_webhook_verified_at_ms", {
        mode: "number",
      }),
      lastVerifiedAtMs: bigint("last_verified_at_ms", { mode: "number" }),
      failureReasonCode: text("failure_reason_code"),
      createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
      updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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

export const openMeldRemoteAgentLarkPlatformRegistrationAttempts =
  applicationTable(
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
      applicationVersionId: text("application_version_id"),
      accountDomain: text("account_domain").notNull(),
      detectedBrand: text("detected_brand", {
        enum: ["lark", "feishu"],
      }),
      connectionId: text("connection_id"),
      pollIntervalMs: bigint("poll_interval_ms", { mode: "number" }).notNull(),
      nextPollAtMs: bigint("next_poll_at_ms", { mode: "number" }).notNull(),
      expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
      pollClaimId: text("poll_claim_id"),
      pollClaimExpiresAtMs: bigint("poll_claim_expires_at_ms", {
        mode: "number",
      }),
      permissionMode: text("permission_mode", {
        enum: ["channel_only_template", "official_preset"],
      }).notNull(),
      permissionBundleVersion: text("permission_bundle_version").notNull(),
      returnPath: text("return_path").notNull(),
      status: text("status").notNull(),
      failureReasonCode: text("failure_reason_code"),
      consumedAtMs: bigint("consumed_at_ms", { mode: "number" }),
      createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
      updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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

export const openMeldRemoteAgentLarkPlatformChannelCredentials =
  applicationTable(
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
      credentialFormatVersion: bigint("credential_format_version", {
        mode: "number",
      }).notNull(),
      createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
      updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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

export const openMeldRemoteAgentLarkPlatformIdentityLinks = applicationTable(
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
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
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

export const openMeldRemoteAgentMessageChannelIdentityLinkTokens =
  applicationTable(
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
      issuedAtMs: bigint("issued_at_ms", { mode: "number" }).notNull(),
      expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
      claimedByUserId: text("claimed_by_user_id"),
      claimedAtMs: bigint("claimed_at_ms", { mode: "number" }),
      membershipRequirement: text("membership_requirement", {
        enum: ["allow_enrollment", "current_member"],
      })
        .notNull()
        .default("allow_enrollment"),
      consumedAtMs: bigint("consumed_at_ms", { mode: "number" }),
      consumeNonce: text("consume_nonce"),
      continuationAttempt: bigint("continuation_attempt", { mode: "number" })
        .notNull()
        .default(0),
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

export const openMeldRemoteAgentLarkPlatformContextCursors = applicationTable(
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
    connectionGeneration: bigint("connection_generation", {
      mode: "number",
    }).notNull(),
    syncedThroughMessageId: text("synced_through_message_id").notNull(),
    syncedThroughAtMs: bigint("synced_through_at_ms", {
      mode: "number",
    }).notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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

export const openMeldRemoteAgentMessageChannelEventIngress = applicationTable(
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
    claimExpiresAtMs: bigint("claim_expires_at_ms", { mode: "number" }),
    firstReceivedAtMs: bigint("first_received_at_ms", {
      mode: "number",
    }).notNull(),
    lastReceivedAtMs: bigint("last_received_at_ms", {
      mode: "number",
    }).notNull(),
    deliveryAttemptCount: bigint("delivery_attempt_count", { mode: "number" })
      .default(0)
      .notNull(),
    providerRetrySequence: bigint("provider_retry_sequence", {
      mode: "number",
    }),
    retryReasonCode: text("retry_reason_code"),
    gatewayRequestId: text("gateway_request_id").notNull(),
    queueMessageId: text("queue_message_id"),
    queueAttempts: bigint("queue_attempts", { mode: "number" }),
    nativeDeliveryId: text("native_delivery_id"),
    outcomeStatus: text("outcome_status"),
    failureReasonCode: text("failure_reason_code"),
    completedAtMs: bigint("completed_at_ms", { mode: "number" }),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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
