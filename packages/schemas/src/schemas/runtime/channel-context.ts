import { z } from "zod/v4";
import { messageChannelProviderSchema } from "./message-channel";

export const CHANNEL_CONTEXT_MAX_MESSAGES = 20;
export const CHANNEL_CONTEXT_MESSAGE_TEXT_MAX_CHARS = 4000;
export const CHANNEL_CONTEXT_TOTAL_TEXT_MAX_CHARS = 16_000;

const nonEmptyStringSchema = z.string().trim().min(1);
export const channelContextAuthorSchema = z.strictObject({
  kind: z.enum(["human", "agent", "bot", "system", "unknown"]),
  id: nonEmptyStringSchema.max(256).optional(),
  displayName: nonEmptyStringSchema.max(256).optional(),
});

export const channelContextMessageSchema = z.strictObject({
  id: nonEmptyStringSchema.max(256),
  author: channelContextAuthorSchema,
  sentAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  text: nonEmptyStringSchema.max(CHANNEL_CONTEXT_MESSAGE_TEXT_MAX_CHARS),
});

export const channelContextSyncSchema = z.strictObject({
  mode: z.enum(["snapshot", "delta"]),
  status: z.enum([
    "complete",
    "truncated",
    "unavailable",
    "forbidden",
    "rate_limited",
  ]),
});

export const channelContextSchema = z
  .strictObject({
    provider: messageChannelProviderSchema,
    conversationId: nonEmptyStringSchema.max(512),
    currentMessageId: nonEmptyStringSchema.max(256),
    sync: channelContextSyncSchema,
    messages: z
      .array(channelContextMessageSchema)
      .max(CHANNEL_CONTEXT_MAX_MESSAGES),
  })
  .superRefine((context, refinement) => {
    if (
      context.sync.status !== "complete" &&
      context.sync.status !== "truncated" &&
      context.messages.length > 0
    ) {
      refinement.addIssue({
        code: "custom",
        message:
          "Unavailable channel context statuses cannot include message records.",
        path: ["messages"],
      });
    }

    const messageIds = new Set<string>();
    let previousSentAtMs = -1;
    let totalTextCharacters = 0;
    for (const [index, message] of context.messages.entries()) {
      if (messageIds.has(message.id)) {
        refinement.addIssue({
          code: "custom",
          message: "Channel context message identifiers must be unique.",
          path: ["messages", index, "id"],
        });
      }
      messageIds.add(message.id);

      if (message.id === context.currentMessageId) {
        refinement.addIssue({
          code: "custom",
          message:
            "The current trigger message must not be duplicated in channel context.",
          path: ["messages", index, "id"],
        });
      }
      if (message.sentAtMs < previousSentAtMs) {
        refinement.addIssue({
          code: "custom",
          message: "Channel context messages must be ordered by sentAtMs.",
          path: ["messages", index, "sentAtMs"],
        });
      } else {
        previousSentAtMs = message.sentAtMs;
      }
      totalTextCharacters += message.text.length;
    }

    if (totalTextCharacters > CHANNEL_CONTEXT_TOTAL_TEXT_MAX_CHARS) {
      refinement.addIssue({
        code: "custom",
        message: "Channel context message text exceeds the total size limit.",
        path: ["messages"],
      });
    }
  });
