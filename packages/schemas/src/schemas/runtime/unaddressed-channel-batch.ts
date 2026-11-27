import * as z from "zod/v4";

/**
 * Unaddressed Channel messages are group messages that neither mention the
 * bot nor arrive in a direct message. Core archives each one, groups a burst
 * into one batch, and asks the worker to route that batch before any turn
 * starts.
 */
export const UNADDRESSED_CHANNEL_BATCH_ROUTES = [
  "follow_up",
  "new_request",
  "chatter",
] as const;
export const UNADDRESSED_CHANNEL_BATCH_MAX_MESSAGES = 20;
export const UNADDRESSED_CHANNEL_BATCH_MESSAGE_TEXT_MAX_CHARS = 4000;

const identifierSchema = z.string().trim().min(1).max(512);

export const unaddressedChannelBatchRouteSchema = z.enum(
  UNADDRESSED_CHANNEL_BATCH_ROUTES
);

export const unaddressedChannelBatchQueueMessageSchema = z.strictObject({
  v: z.literal(1),
  kind: z.literal("remote_agent_message_channel_unaddressed_batch"),
  provider: z.enum(["slack", "lark", "feishu"]),
  connectionId: identifierSchema,
  conversationKey: identifierSchema,
  batchKey: identifierSchema,
  // The observation that scheduled this flush. A later observation in the
  // same batch schedules its own flush, so an earlier one can stand down.
  scheduledByObservedAtMs: z.number().int().nonnegative(),
});

export const classifyUnaddressedChannelBatchInputSchema = z.strictObject({
  organizationId: identifierSchema,
  provider: z.enum(["slack", "lark", "feishu"]),
  batchId: identifierSchema,
  thread: z.strictObject({
    isThreadReply: z.boolean(),
    hasPriorAgentTurn: z.boolean(),
  }),
  messages: z
    .array(
      z.strictObject({
        messageId: identifierSchema,
        senderId: identifierSchema,
        text: z.string().max(UNADDRESSED_CHANNEL_BATCH_MESSAGE_TEXT_MAX_CHARS),
        attachmentCount: z.number().int().nonnegative().max(10),
      })
    )
    .min(1)
    .max(UNADDRESSED_CHANNEL_BATCH_MAX_MESSAGES),
});

export const classifyUnaddressedChannelBatchResponseSchema = z.strictObject({
  route: unaddressedChannelBatchRouteSchema,
});

export type UnaddressedChannelBatchRoute = z.infer<
  typeof unaddressedChannelBatchRouteSchema
>;
export type UnaddressedChannelBatchQueueMessage = z.infer<
  typeof unaddressedChannelBatchQueueMessageSchema
>;
export type ClassifyUnaddressedChannelBatchInput = z.infer<
  typeof classifyUnaddressedChannelBatchInputSchema
>;
export type ClassifyUnaddressedChannelBatchResponse = z.infer<
  typeof classifyUnaddressedChannelBatchResponseSchema
>;
