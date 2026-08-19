import { z } from "zod/v4";
import {
  MESSAGE_CHANNEL_PROVIDERS,
  messageChannelIngressEnvelopeSchema,
  messageChannelProviderSchema,
  messageChannelTransportSchema,
} from "../runtime/message-channel";

export const MESSAGE_CHANNEL_CONNECTION_STATUSES = [
  "pending_registration",
  "credentials_received",
  "configuring",
  "connected",
  "repair_required",
  "revoked",
  "disconnected",
] as const;
export const MESSAGE_CHANNEL_ERROR_CODES = [
  "message_channel.actor_required",
  "message_channel.already_connected",
  "message_channel.connection_changed",
  "message_channel.identity_already_linked",
  "message_channel.identity_link_account_required",
  "message_channel.identity_link_membership_required",
  "message_channel.identity_link_not_found",
  "message_channel.identity_link_token_invalid",
  "message_channel.organization_required",
  "message_channel.provider_disabled",
  "message_channel.provider_unavailable",
  "message_channel.repair_unavailable",
  "message_channel.registration_not_found",
  "message_channel.store_unavailable",
] as const;
export const LARK_PLATFORM_WEBHOOK_RAW_BODY_MAX_BYTES = 262_144;
export const LARK_PLATFORM_WEBHOOK_RAW_BODY_MAX_CHARS =
  LARK_PLATFORM_WEBHOOK_RAW_BODY_MAX_BYTES;

const nonEmptyStringSchema = z.string().trim().min(1);
const capabilityGroupSchema = nonEmptyStringSchema
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const reasonCodeSchema = nonEmptyStringSchema
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);

export const messageChannelConnectionStatusSchema = z.enum(
  MESSAGE_CHANNEL_CONNECTION_STATUSES
);
export const messageChannelIdentityLinkIdSchema = nonEmptyStringSchema
  .max(82)
  .regex(/^channel_identity_[0-9a-f]{64}$/u);
export const larkPlatformProviderSchema = z.enum(["lark", "feishu"]);
export const larkPlatformRegistrationBeginModeSchema = z.enum([
  "resume",
  "restart",
  "repair",
]);

export const messageChannelConnectionProjectionSchema = z
  .strictObject({
    id: nonEmptyStringSchema.max(256),
    provider: messageChannelProviderSchema,
    transport: messageChannelTransportSchema,
    status: messageChannelConnectionStatusSchema,
    externalAccountId: nonEmptyStringSchema.max(512).nullable(),
    externalAccountName: nonEmptyStringSchema.max(256).nullable(),
    permissionBundleVersion: nonEmptyStringSchema.max(128).nullable(),
    grantedCapabilityGroups: z.array(capabilityGroupSchema).max(32),
    lastVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
    reasonCode: reasonCodeSchema.nullable(),
  })
  .superRefine((connection, context) => {
    if (
      new Set(connection.grantedCapabilityGroups).size !==
      connection.grantedCapabilityGroups.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Granted capability groups must be unique.",
        path: ["grantedCapabilityGroups"],
      });
    }
  });

const messageChannelIdentityLinkProjectionSchema = z.strictObject({
  connectedAt: z.iso.datetime({ offset: true }),
  id: messageChannelIdentityLinkIdSchema,
  openMeldUserId: nonEmptyStringSchema.max(256),
  provider: messageChannelProviderSchema,
  providerAccountName: nonEmptyStringSchema.max(256).nullable(),
});

export const messageChannelConnectionListResponseSchema = z
  .strictObject({
    organizationId: nonEmptyStringSchema.max(256),
    availableLarkPlatformProviders: z.array(larkPlatformProviderSchema).max(2),
    connections: z
      .array(messageChannelConnectionProjectionSchema)
      .max(MESSAGE_CHANNEL_PROVIDERS.length),
    identityLinks: z
      .array(messageChannelIdentityLinkProjectionSchema)
      .max(10_000)
      .default([]),
  })
  .superRefine((response, context) => {
    if (
      new Set(response.availableLarkPlatformProviders).size !==
      response.availableLarkPlatformProviders.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Available Message Channel providers must be unique.",
        path: ["availableLarkPlatformProviders"],
      });
    }
    const providers = new Set<(typeof MESSAGE_CHANNEL_PROVIDERS)[number]>();
    for (const [index, connection] of response.connections.entries()) {
      if (providers.has(connection.provider)) {
        context.addIssue({
          code: "custom",
          message:
            "An Organization can expose at most one connection per Message Channel provider.",
          path: ["connections", index, "provider"],
        });
      }
      providers.add(connection.provider);
    }
  });

export const larkPlatformRegistrationAttemptIdSchema =
  nonEmptyStringSchema.max(256);

export const larkPlatformActiveRegistrationProjectionSchema = z.strictObject({
  canResume: z.boolean(),
  expiresAt: z.iso.datetime({ offset: true }),
  id: larkPlatformRegistrationAttemptIdSchema,
  nextPollAt: z.iso.datetime({ offset: true }),
  provider: larkPlatformProviderSchema,
  reasonCode: reasonCodeSchema.nullable(),
  status: z.enum([
    "pending_registration",
    "credentials_received",
    "configuring",
  ]),
});

export const larkPlatformActiveRegistrationListResponseSchema = z
  .strictObject({
    organizationId: nonEmptyStringSchema.max(256),
    registrations: z
      .array(larkPlatformActiveRegistrationProjectionSchema)
      .max(2),
  })
  .superRefine((response, context) => {
    const providers = new Set<string>();
    for (const [index, registration] of response.registrations.entries()) {
      if (providers.has(registration.provider)) {
        context.addIssue({
          code: "custom",
          message:
            "An Organization can expose at most one active registration per Lark-platform provider.",
          path: ["registrations", index, "provider"],
        });
      }
      providers.add(registration.provider);
    }
  });

export const larkPlatformRegistrationAttemptProjectionSchema = z
  .strictObject({
    id: larkPlatformRegistrationAttemptIdSchema,
    provider: larkPlatformProviderSchema,
    status: messageChannelConnectionStatusSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    nextPollAt: z.iso.datetime({ offset: true }),
    registrationUrl: z.string().trim().max(16_384).url().nullable(),
    reasonCode: reasonCodeSchema.nullable(),
  })
  .superRefine((attempt, context) => {
    if (
      (attempt.status === "pending_registration") !==
      (attempt.registrationUrl !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Only a pending registration attempt may expose its registration URL.",
        path: ["registrationUrl"],
      });
    }
    if (attempt.registrationUrl) {
      const url = new URL(attempt.registrationUrl);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "open.feishu.cn" ||
        url.pathname !== "/page/launcher"
      ) {
        context.addIssue({
          code: "custom",
          message: "Registration URL must use the pinned provider launcher.",
          path: ["registrationUrl"],
        });
      }
    }
  });

export const larkPlatformRegistrationResponseSchema = z
  .strictObject({
    organizationId: nonEmptyStringSchema.max(256),
    attempt: larkPlatformRegistrationAttemptProjectionSchema,
    connection: messageChannelConnectionProjectionSchema.nullable(),
  })
  .superRefine((response, context) => {
    if (
      response.connection &&
      response.connection.provider !== response.attempt.provider
    ) {
      context.addIssue({
        code: "custom",
        message: "Registration attempt and connection providers must match.",
        path: ["connection", "provider"],
      });
    }
  });

export const larkPlatformWebhookVerificationInputSchema = z.strictObject({
  provider: larkPlatformProviderSchema,
  connectionId: nonEmptyStringSchema.max(256),
  surface: z.enum(["events", "callbacks"]),
  rawBody: z.string().min(2).max(LARK_PLATFORM_WEBHOOK_RAW_BODY_MAX_CHARS),
  headers: z.strictObject({
    timestamp: nonEmptyStringSchema.max(64).nullable(),
    nonce: nonEmptyStringSchema.max(256).nullable(),
    signature: nonEmptyStringSchema.max(256).nullable(),
  }),
  receivedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  gatewayRequestId: nonEmptyStringSchema.max(256),
});

export const larkPlatformWebhookVerificationResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("challenge"),
      challenge: nonEmptyStringSchema.max(2048),
    }),
    z.strictObject({
      status: z.literal("enqueue"),
      envelope: messageChannelIngressEnvelopeSchema,
    }),
    z.strictObject({
      status: z.literal("ignored"),
      reasonCode: reasonCodeSchema,
    }),
    z.strictObject({
      status: z.literal("rejected"),
      reasonCode: reasonCodeSchema,
    }),
  ]);

export const messageChannelIdentityLinkTokenSchema = z
  .string()
  .trim()
  .regex(/^messagechannellink_[0-9a-f]{64}$/);

export const messageChannelIdentityLinkPreviewBodySchema = z.strictObject({
  token: messageChannelIdentityLinkTokenSchema,
});

export const messageChannelIdentityLinkPreviewResponseSchema = z.strictObject({
  alreadyMember: z.boolean().default(true),
  continuesRequest: z.boolean().default(false),
  expiresAt: z.iso.datetime({ offset: true }),
  organizationId: nonEmptyStringSchema.max(256),
  organizationName: nonEmptyStringSchema.max(256),
  provider: larkPlatformProviderSchema,
  providerUserDisplayName: nonEmptyStringSchema.max(256),
  providerUserId: nonEmptyStringSchema.max(512),
  openMeldAccountEmail: nonEmptyStringSchema.max(320),
  replacesExistingLink: z.boolean().default(false),
});

export const messageChannelIdentityLinkConsumeBodySchema = z.strictObject({
  token: messageChannelIdentityLinkTokenSchema,
});

export const messageChannelIdentityLinkConsumeResponseSchema = z.strictObject({
  continuationRetryable: z.boolean().default(false),
  continued: z.boolean().default(false),
  continuesRequest: z.boolean().default(false),
  joinedOrganization: z.boolean().default(false),
  linked: z.literal(true),
  organizationId: nonEmptyStringSchema.max(256),
  organizationName: nonEmptyStringSchema.max(256),
  provider: larkPlatformProviderSchema,
  providerUserDisplayName: nonEmptyStringSchema.max(256),
  providerUserId: nonEmptyStringSchema.max(512),
  replacedExistingLink: z.boolean().default(false),
  openMeldUserId: nonEmptyStringSchema.max(256),
});
