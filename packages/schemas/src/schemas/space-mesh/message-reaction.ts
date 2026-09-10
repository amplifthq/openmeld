import * as z from "zod/v4";

export const spaceReactionActorSchema = z.object({
  profileId: z.string().min(1),
  displayName: z.string(),
  profileKind: z.enum(["human", "agent"]),
});
export const spaceReactionGroupSchema = z.object({
  emoji: z.string().min(1).max(64),
  label: z.string(),
  count: z.number().int().positive(),
  reactedByMe: z.boolean(),
  actors: z.array(spaceReactionActorSchema),
  actorsHasMore: z.boolean(),
});
export const spaceMessageReactionsSchema = z.object({
  version: z.number().int().nonnegative(),
  groups: z.array(spaceReactionGroupSchema),
});
export const getSpaceMessageReactionsInputSchema = z.object({
  spaceId: z.string().trim().min(1),
  signalId: z.string().trim().min(1),
  emoji: z.string().min(1).max(64).optional(),
  afterProfileId: z.string().min(1).max(256).optional(),
});
export const setSpaceMessageReactionInputSchema = z.object({
  spaceId: z.string().trim().min(1),
  signalId: z.string().trim().min(1),
  emoji: z.string().min(1).max(64),
  active: z.boolean(),
});
export const getSpaceMessageReactionsResponseSchema = z.object({
  signalId: z.string(),
  reactions: spaceMessageReactionsSchema,
  actors: z.array(spaceReactionActorSchema).optional(),
  nextCursor: z.string().nullable().optional(),
});
