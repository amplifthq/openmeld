import * as z from "zod/v4";
import { clientMessageIdSchema } from "../protocol/client-message-id";

const selectorSchema = z.string().trim().min(1);

/** The Agent View `space.send.request` data, emitted before publication. */
export const spaceSendRequestReceiptSchema = z.strictObject({
  spaceId: selectorSchema,
  clientMessageId: clientMessageIdSchema,
  targetProfileIds: z.array(selectorSchema),
  // Ordinary sends can announce the identity before resolving the acting Profile.
  profileId: selectorSchema.optional(),
});

export type SpaceSendRequestReceipt = z.infer<
  typeof spaceSendRequestReceiptSchema
>;
