import * as z from "zod/v4";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import { MAX_TEXT_LENGTH } from "../protocol/constants";
import { centerAgentExecutionInputTargetSchema } from "../protocol/signal";

const inputId = clientMessageIdSchema;
const target = centerAgentExecutionInputTargetSchema;

export const spaceInputQueueMutationSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("enqueue"),
    inputId,
    target,
    text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  }),
  z.strictObject({ action: z.literal("delete"), inputId }),
  z.strictObject({ action: z.literal("steer"), inputId, target }),
  z.strictObject({
    action: z.literal("reorder"),
    expectedIds: z.array(inputId).max(50),
    orderedIds: z.array(inputId).max(50),
  }),
]);

export const spaceInputQueueResponseSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      inputId,
      target,
      authorProfileId: z.string().min(1),
      text: z.string(),
      state: z.enum(["queued", "claimed", "unconfirmed"]),
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
