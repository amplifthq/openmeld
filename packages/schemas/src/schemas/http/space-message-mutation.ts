import * as z from "zod/v4";
import { MAX_TEXT_LENGTH } from "../protocol/constants";
import { signalTextEnvelopeSchema } from "../protocol/envelope";

export const SPACE_MESSAGE_CHANGED_PURPOSE = "space_message_changed" as const;

export const spaceMessageMutationBodySchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("edit"),
    expectedRevision: z.number().int().nonnegative(),
    text: z.string().max(MAX_TEXT_LENGTH),
    retainedFileIds: z.array(z.string().min(1)).optional(),
    retainedAttachmentIds: z.array(z.string().min(1)).optional(),
  }),
  z.strictObject({
    action: z.literal("recall"),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({ action: z.literal("restore_draft") }),
]);

export const spaceMessageMutationResponseSchema = z.strictObject({
  message: signalTextEnvelopeSchema,
});

export type SpaceMessageMutationBody = z.infer<
  typeof spaceMessageMutationBodySchema
>;
export type SpaceMessageMutationResponse = z.infer<
  typeof spaceMessageMutationResponseSchema
>;
