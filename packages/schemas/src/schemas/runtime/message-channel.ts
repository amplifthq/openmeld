import * as z from "zod/v4";

export const MESSAGE_CHANNEL_PROVIDERS = ["slack", "lark", "feishu"] as const;
export const MESSAGE_CHANNEL_TRANSPORTS = ["webhook", "websocket"] as const;
export const MESSAGE_CHANNEL_EVENT_KINDS = [
  "message",
  "card_action",
  "bot_added",
  "reaction",
  "document_comment",
] as const;
export const MESSAGE_CHANNEL_RESOURCE_TYPES = [
  "image",
  "file",
  "audio",
  "video",
  "sticker",
] as const;
export const MESSAGE_CHANNEL_MENTION_TYPES = [
  "direct_message",
  "group_mention",
  "group_message",
  "none",
] as const;

export const MESSAGE_CHANNEL_EVENT_TEXT_MAX_CHARS = 4000;
export const MESSAGE_CHANNEL_MAX_RESOURCES = 10;

const nonEmptyStringSchema = z.string().trim().min(1);
const providerIdSchema = nonEmptyStringSchema.max(512);
const SLACK_MESSAGE_TIMESTAMP_PATTERN = /^\d+\.\d+$/u;
const SLACK_THREAD_PERMALINK_PATH_PATTERN =
  /^\/archives\/([A-Za-z0-9_-]+)\/p(\d{10})(\d{1,6})\/?$/u;
const timestampMsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const slackMessagePermalinkSchema = z
  .url()
  .max(2048)
  .refine(isSlackMessagePermalink, {
    message: "Slack permalinks must use an HTTPS slack.com host.",
  });

export const slackThreadPublicationPermalinkSchema =
  slackMessagePermalinkSchema.refine(
    (value) => parseSlackThreadPublicationPermalink(value) !== null,
    {
      message:
        "Slack thread permalinks must identify an exact Slack channel message.",
    }
  );

export function parseSlackThreadPublicationPermalink(value: string): {
  channelId: string;
  threadTs: string;
} | null {
  if (!slackMessagePermalinkSchema.safeParse(value).success) {
    return null;
  }
  const url = new URL(value);
  const pathMatch = SLACK_THREAD_PERMALINK_PATH_PATTERN.exec(url.pathname);
  if (!pathMatch) {
    return null;
  }
  const channelId = pathMatch[1];
  const seconds = pathMatch[2];
  const fractional = pathMatch[3];
  if (!(channelId && seconds && fractional)) {
    return null;
  }
  const queryChannelId = url.searchParams.get("cid");
  if (queryChannelId && queryChannelId !== channelId) {
    return null;
  }
  const queryThreadTs = url.searchParams.get("thread_ts");
  if (queryThreadTs && !SLACK_MESSAGE_TIMESTAMP_PATTERN.test(queryThreadTs)) {
    return null;
  }
  return {
    channelId,
    threadTs: queryThreadTs ?? `${seconds}.${fractional}`,
  };
}

function isSlackMessagePermalink(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (hostname === "slack.com" || hostname.endsWith(".slack.com"))
  );
}

export const messageChannelProviderSchema = z.enum(MESSAGE_CHANNEL_PROVIDERS);
export const messageChannelParticipantIdentitySchema = z.strictObject({
  connectionId: providerIdSchema,
  provider: messageChannelProviderSchema,
  providerUserEmail: z.email().max(320).optional(),
  providerUserId: providerIdSchema,
});
export const messageChannelTransportSchema = z.enum(MESSAGE_CHANNEL_TRANSPORTS);
export const messageChannelEventKindSchema = z.enum(
  MESSAGE_CHANNEL_EVENT_KINDS
);
export const messageChannelResourceTypeSchema = z.enum(
  MESSAGE_CHANNEL_RESOURCE_TYPES
);
export const messageChannelMentionTypeSchema = z.enum(
  MESSAGE_CHANNEL_MENTION_TYPES
);

const slackMessageChannelConversationLocatorSchema = z.strictObject({
  provider: z.literal("slack"),
  connectionId: providerIdSchema,
  teamId: providerIdSchema,
  channelId: providerIdSchema,
  rootMessageId: providerIdSchema,
});

const createLarkPlatformConversationLocatorSchema = <
  const Provider extends "lark" | "feishu",
>(
  provider: Provider
) =>
  z.strictObject({
    provider: z.literal(provider),
    connectionId: providerIdSchema,
    appId: providerIdSchema,
    tenantKey: providerIdSchema.nullable(),
    chatId: providerIdSchema,
    rootMessageId: providerIdSchema,
    threadId: providerIdSchema.nullable(),
  });

export const messageChannelConversationLocatorSchema = z.discriminatedUnion(
  "provider",
  [
    slackMessageChannelConversationLocatorSchema,
    createLarkPlatformConversationLocatorSchema("lark"),
    createLarkPlatformConversationLocatorSchema("feishu"),
  ]
);

export const messageChannelResourceDescriptorSchema = z.strictObject({
  type: messageChannelResourceTypeSchema,
  fileKey: providerIdSchema,
  fileName: nonEmptyStringSchema.max(512).nullable(),
  mimeType: nonEmptyStringSchema.max(256).nullable(),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
});

const messageChannelConversationEventShape = {
  locator: messageChannelConversationLocatorSchema,
};

export const normalizedMessageChannelMessageEventSchema = z.strictObject({
  kind: z.literal("message"),
  messageId: providerIdSchema,
  sentAtMs: timestampMsSchema,
  senderId: providerIdSchema,
  senderDisplayName: nonEmptyStringSchema.max(256).optional(),
  senderTenantKey: providerIdSchema.optional(),
  ...messageChannelConversationEventShape,
  text: nonEmptyStringSchema.max(MESSAGE_CHANNEL_EVENT_TEXT_MAX_CHARS),
  mention: messageChannelMentionTypeSchema,
  resources: z
    .array(messageChannelResourceDescriptorSchema)
    .max(MESSAGE_CHANNEL_MAX_RESOURCES),
});

export const normalizedMessageChannelCardActionEventSchema = z.strictObject({
  kind: z.literal("card_action"),
  actionId: providerIdSchema,
  occurredAtMs: timestampMsSchema,
  senderId: providerIdSchema,
  ...messageChannelConversationEventShape,
  actionName: nonEmptyStringSchema.max(128),
  actionValue: nonEmptyStringSchema.max(2000).nullable(),
});

export const normalizedMessageChannelBotAddedEventSchema = z.strictObject({
  kind: z.literal("bot_added"),
  chatId: providerIdSchema,
  occurredAtMs: timestampMsSchema,
  addedById: providerIdSchema.nullable(),
});

export const normalizedMessageChannelReactionEventSchema = z.strictObject({
  kind: z.literal("reaction"),
  messageId: providerIdSchema,
  occurredAtMs: timestampMsSchema,
  senderId: providerIdSchema,
  ...messageChannelConversationEventShape,
  reaction: nonEmptyStringSchema.max(128),
  operation: z.enum(["add", "remove"]),
});

export const normalizedMessageChannelDocumentCommentEventSchema =
  z.strictObject({
    kind: z.literal("document_comment"),
    commentId: providerIdSchema,
    documentToken: providerIdSchema,
    occurredAtMs: timestampMsSchema,
    senderId: providerIdSchema,
    ...messageChannelConversationEventShape,
    text: nonEmptyStringSchema.max(MESSAGE_CHANNEL_EVENT_TEXT_MAX_CHARS),
  });

export const normalizedMessageChannelEventSchema = z.discriminatedUnion(
  "kind",
  [
    normalizedMessageChannelMessageEventSchema,
    normalizedMessageChannelCardActionEventSchema,
    normalizedMessageChannelBotAddedEventSchema,
    normalizedMessageChannelReactionEventSchema,
    normalizedMessageChannelDocumentCommentEventSchema,
  ]
);

export const messageChannelIngressEnvelopeSchema = z
  .strictObject({
    v: z.literal(1),
    kind: z.literal("remote_agent_message_channel_event"),
    provider: messageChannelProviderSchema,
    connectionId: providerIdSchema,
    providerEventId: providerIdSchema,
    // Persistent ingress pins accepted work to its connection incarnation.
    // Optional for Webhook events already queued before connector rollout.
    connectionGeneration: z.number().int().positive().optional(),
    receivedAtMs: timestampMsSchema,
    gatewayRequestId: providerIdSchema,
    event: normalizedMessageChannelEventSchema,
  })
  .superRefine((envelope, context) => {
    if (!("locator" in envelope.event)) {
      return;
    }
    if (envelope.event.locator.provider !== envelope.provider) {
      context.addIssue({
        code: "custom",
        message: "Ingress provider must match the conversation locator.",
        path: ["event", "locator", "provider"],
      });
    }
    if (envelope.event.locator.connectionId !== envelope.connectionId) {
      context.addIssue({
        code: "custom",
        message: "Ingress connection must match the conversation locator.",
        path: ["event", "locator", "connectionId"],
      });
    }
  });

type MessageChannelConversationLocator = z.infer<
  typeof messageChannelConversationLocatorSchema
>;

export function buildMessageChannelConversationId(
  locator: MessageChannelConversationLocator
): string {
  if (locator.provider === "slack") {
    return [
      locator.provider,
      locator.connectionId,
      locator.channelId,
      locator.rootMessageId,
    ]
      .map(encodeConversationIdPart)
      .join(":");
  }
  return [
    locator.provider,
    locator.connectionId,
    locator.chatId,
    locator.rootMessageId,
  ]
    .map(encodeConversationIdPart)
    .join(":");
}

function encodeConversationIdPart(value: string): string {
  return encodeURIComponent(value);
}
