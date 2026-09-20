import type * as z from "zod/v4";
import type {
  getSpaceMessageReactionsInputSchema,
  getSpaceMessageReactionsResponseSchema,
  setSpaceMessageReactionInputSchema,
  spaceMessageReactionsSchema,
  spaceReactionActorSchema,
  spaceReactionGroupSchema,
} from "../../schemas/space-mesh/message-reaction";
export type SpaceReactionActor = z.infer<typeof spaceReactionActorSchema>;
export type SpaceReactionGroup = z.infer<typeof spaceReactionGroupSchema>;
export type SpaceMessageReactions = z.infer<typeof spaceMessageReactionsSchema>;
export type GetSpaceMessageReactionsInput = z.infer<
  typeof getSpaceMessageReactionsInputSchema
>;
export type SetSpaceMessageReactionInput = z.infer<
  typeof setSpaceMessageReactionInputSchema
>;
export type GetSpaceMessageReactionsResponse = z.infer<
  typeof getSpaceMessageReactionsResponseSchema
>;
