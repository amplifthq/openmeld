import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "./schemas/daemon/profile-identity";

export const deleteConversationForMeInputSchema = z.strictObject({
  spaceId: z.string().trim().min(1).max(200),
  context: openMeldRequestContextSchema,
});
export const deleteConversationForMeResponseSchema = z.strictObject({
  spaceId: z.string().min(1),
  deletedAt: z.number().int().positive(),
});
export type DeleteConversationForMeInput = z.infer<
  typeof deleteConversationForMeInputSchema
>;
export type DeleteConversationForMeResponse = z.infer<
  typeof deleteConversationForMeResponseSchema
>;
