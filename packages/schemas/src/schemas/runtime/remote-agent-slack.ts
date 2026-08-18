import { z } from "zod/v4";

const nonEmptyStringSchema = z.string().trim().min(1);

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
