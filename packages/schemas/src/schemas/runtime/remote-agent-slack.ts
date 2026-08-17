import { z } from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

const nonEmptyStringSchema = z.string().trim().min(1);
export const REMOTE_AGENT_TRANSIENT_SLACK_CONTENT_MAX_CHARS = 4000;

export const remoteAgentSlackUrlVerificationPayloadSchema = z.object({
  type: z.literal("url_verification"),
  challenge: nonEmptyStringSchema,
});

export const remoteAgentSlackEventCallbackPayloadSchema = z.object({
  type: z.literal("event_callback"),
  team_id: nonEmptyStringSchema,
  event_id: nonEmptyStringSchema.optional(),
  event_time: z.number().int().nonnegative().optional(),
  event: z.object({ type: nonEmptyStringSchema }).catchall(z.unknown()),
});

export const remoteAgentSlackAppMentionEventSchema = z
  .object({
    type: z.literal("app_mention"),
    user: nonEmptyStringSchema,
    text: nonEmptyStringSchema,
    ts: nonEmptyStringSchema,
    channel: nonEmptyStringSchema,
    action_token: nonEmptyStringSchema.max(4096).optional(),
    thread_ts: nonEmptyStringSchema.optional(),
    event_ts: nonEmptyStringSchema.optional(),
  })
  .catchall(z.unknown());

export const remoteAgentSlackDirectMessageEventSchema = z
  .object({
    type: z.literal("message"),
    channel_type: z.literal("im"),
    user: nonEmptyStringSchema,
    text: nonEmptyStringSchema,
    ts: nonEmptyStringSchema,
    channel: nonEmptyStringSchema,
    action_token: nonEmptyStringSchema.max(4096).optional(),
    bot_id: z.never().optional(),
    subtype: z.never().optional(),
    thread_ts: nonEmptyStringSchema.optional(),
    event_ts: nonEmptyStringSchema.optional(),
  })
  .catchall(z.unknown());

const remoteAgentTransientSlackEvidenceItemSchema = z.strictObject({
  authorName: nonEmptyStringSchema.max(256),
  authorUserId: nonEmptyStringSchema.max(256),
  channelId: nonEmptyStringSchema.max(256),
  channelName: nonEmptyStringSchema.max(256),
  content: nonEmptyStringSchema.max(
    REMOTE_AGENT_TRANSIENT_SLACK_CONTENT_MAX_CHARS
  ),
  isAuthorBot: z.boolean(),
  messageTs: nonEmptyStringSchema.max(64),
  permalink: z.url().max(2048),
});

export const remoteAgentTransientSlackMessageSchema =
  remoteAgentTransientSlackEvidenceItemSchema.extend({
    contextMessages: z
      .array(remoteAgentTransientSlackEvidenceItemSchema)
      .max(4),
  });

export const remoteAgentTransientSlackSearchRequestSchema = z.strictObject({
  includeBots: z.boolean(),
  organizationId: nonEmptyStringSchema.max(256),
  query: nonEmptyStringSchema.max(500),
  requestContext: openMeldRequestContextSchema,
  requester: z.strictObject({
    memberId: nonEmptyStringSchema.max(256),
    slackUserId: nonEmptyStringSchema.max(256),
    userId: nonEmptyStringSchema.max(256),
  }),
  searchAuthorization: z.strictObject({
    encryptedAuthorization: nonEmptyStringSchema.max(8192),
  }),
  v: z.literal(1),
});

export const remoteAgentTransientSlackSearchResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      messages: z.array(remoteAgentTransientSlackMessageSchema).max(12),
      moreResultsAvailable: z.boolean(),
      status: z.literal("found"),
      v: z.literal(1),
    }),
    z.strictObject({
      reason: nonEmptyStringSchema.max(500),
      status: z.enum([
        "authorization_expired",
        "forbidden",
        "rate_limited",
        "unavailable",
      ]),
      v: z.literal(1),
    }),
  ]);

export const remoteAgentSlackEventsApiPayloadSchema = z.union([
  remoteAgentSlackUrlVerificationPayloadSchema,
  remoteAgentSlackEventCallbackPayloadSchema,
]);

export const remoteAgentSlackEventQueueMessageSchema = z.strictObject({
  gatewayRequestId: nonEmptyStringSchema.max(256),
  kind: z.literal("remote_agent_slack_event"),
  payload: remoteAgentSlackEventCallbackPayloadSchema,
  receivedAtMs: z.number().int().nonnegative(),
  slackRetryNum: z.number().int().nonnegative().nullable(),
  slackRetryReason: z.string().trim().min(1).max(128).nullable(),
  v: z.literal(1),
});
