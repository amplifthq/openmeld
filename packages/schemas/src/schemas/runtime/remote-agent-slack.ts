import * as z from "zod/v4";

const nonEmptyStringSchema = z.string().trim().min(1);

export const remoteAgentSlackEventFileSchema = z
  .object({
    id: nonEmptyStringSchema.max(256),
    mimetype: nonEmptyStringSchema.max(255).optional(),
    name: nonEmptyStringSchema.max(255).optional(),
    permalink: z.url({ protocol: /^https$/u }).optional(),
    size: z.number().int().nonnegative().optional(),
  })
  .catchall(z.unknown());

function requireSlackMessageContent(
  value: {
    files?: readonly unknown[];
    text?: string;
  },
  context: z.core.$RefinementCtx
): void {
  if (value.text?.trim() || (value.files?.length ?? 0) > 0) {
    return;
  }
  context.addIssue({
    code: "custom",
    message: "Slack message must include text or at least one file.",
    path: ["text"],
    input: value,
  });
}

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
    files: z.array(remoteAgentSlackEventFileSchema).max(10).optional(),
    text: z.string().optional(),
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
    files: z.array(remoteAgentSlackEventFileSchema).max(10).optional(),
    text: z.string().optional(),
    ts: nonEmptyStringSchema,
    channel: nonEmptyStringSchema,
    action_token: nonEmptyStringSchema.max(4096).optional(),
    bot_id: z.never().optional(),
    subtype: z.literal("file_share").optional(),
    thread_ts: nonEmptyStringSchema.optional(),
    event_ts: nonEmptyStringSchema.optional(),
  })
  .catchall(z.unknown())
  .superRefine(requireSlackMessageContent);

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
