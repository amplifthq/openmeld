import * as z from "zod/v4";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import { MAX_TEXT_LENGTH } from "../protocol/constants";
import { centerAgentExecutionInputTargetSchema } from "../protocol/signal";
import { spaceThreadIdSchema } from "../space-mesh/space-thread";

const inputId = clientMessageIdSchema;
const target = centerAgentExecutionInputTargetSchema;

export const spaceInputQueueOptionsSchema = z.strictObject({
  includeRecovery: z.boolean().optional(),
  includeConversationContext: z.boolean().optional(),
});
export type SpaceInputQueueOptions = z.infer<
  typeof spaceInputQueueOptionsSchema
>;

export const spaceInputQueueMutationSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("enqueue"),
    inputId,
    target: z.union([
      target,
      z.strictObject({
        clientMessageId: clientMessageIdSchema,
        targetProfileId: z.string().min(1),
      }),
    ]),
    text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  }),
  z.strictObject({ action: z.literal("delete"), inputId }),
  // Puts an input whose delivery could not be confirmed back in the queue.
  z.strictObject({ action: z.literal("retry"), inputId }),
  z.strictObject({ action: z.literal("steer"), inputId, target }),
  z.strictObject({
    action: z.literal("reorder"),
    expectedIds: z.array(inputId).max(50),
    orderedIds: z.array(inputId).max(50),
  }),
]);

export const spaceInputQueueResponseSchema = z.strictObject({
  conversationContextIncluded: z.literal(true).optional(),
  recoveries: z
    .array(
      z.strictObject({
        targetProfileId: z.string().min(1),
        profileName: z.string(),
        action: z.enum(["fork_interrupted_work", "skip_interrupted_work"]),
        expectedInterruptedTargetWakeLifecycleId: z.string().min(1),
      })
    )
    .optional(),
  items: z.array(
    z.strictObject({
      inputId,
      threadId: spaceThreadIdSchema.nullable().optional(),
      target,
      authorProfileId: z.string().min(1),
      text: z.string(),
      state: z.enum(["queued", "claimed", "unconfirmed"]),
      // Unconfirmed only. `checking`: Core is still reading the receipt.
      // `undecided`: it could not tell; the author retries or removes it.
      delivery: z.enum(["checking", "undecided"]).optional(),
      blocked: z.boolean(),
    })
  ),
});

export type SpaceInputQueueMutation = z.infer<
  typeof spaceInputQueueMutationSchema
>;
export type SpaceInputQueueResponse = z.infer<
  typeof spaceInputQueueResponseSchema
>;
