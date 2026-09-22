import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { signalTextEnvelopeSchema } from "../protocol/envelope";
import { inboxItemSchema } from "./inbox";

export const spaceMessageSearchQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => [...value].length >= 1, "Enter at least 1 character."),
  cursor: z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((value) => Number.isSafeInteger(Number(value)))
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export const spaceMessageSearchResponseSchema = z.strictObject({
  signals: z.array(signalTextEnvelopeSchema).max(50),
  nextCursor: z.string().nullable(),
  searchIndexing: z.boolean(),
  threadRoots: z.record(z.string(), z.string()),
});

export type SpaceMessageSearchQuery = z.infer<
  typeof spaceMessageSearchQuerySchema
>;
export type SpaceMessageSearchResponse = z.infer<
  typeof spaceMessageSearchResponseSchema
>;

export const messageSearchCursorSchema = z.strictObject({
  activitiesDone: z.boolean().default(false),
  activityBefore: z.number().int().positive().optional(),
  afterSpaceId: z.string().max(256),
  pending: z
    .array(
      z.strictObject({
        spaceId: z.string().min(1).max(256),
        cursor: spaceMessageSearchQuerySchema.shape.cursor,
      })
    )
    .max(4),
});
const validateMessageSearchLength = (
  input: { q: string; spaceId?: string },
  context: z.RefinementCtx
) => {
  if (!input.spaceId && [...input.q].length < 3) {
    context.addIssue({
      code: "custom",
      message: "Enter at least 3 characters for workspace search.",
      path: ["q"],
    });
  }
};

export const messageSearchQuerySchema = z
  .strictObject({
    q: spaceMessageSearchQuerySchema.shape.q,
    cursor: z.string().max(4096).optional(),
    spaceId: z.string().min(1).max(256).optional(),
    scope: z.enum(["messages", "inbox"]).default("messages"),
  })
  .superRefine(validateMessageSearchLength);
export const messageSearchRpcInputSchema = messageSearchQuerySchema.safeExtend({
  context: openMeldRequestContextSchema,
});
export const messageSearchResponseSchema = z.strictObject({
  activities: z.array(inboxItemSchema).max(30),
  matches: z
    .array(
      z.strictObject({
        signal: signalTextEnvelopeSchema,
        threadRootSignalId: z.string().nullable(),
        spaceName: z.string().nullable(),
        directMessage: z.boolean(),
        centerAgent: z.boolean(),
        inboxItemId: z.string().optional(),
      })
    )
    .max(120),
  nextCursor: z.string().nullable(),
  indexing: z.boolean(),
});
export type MessageSearchRpcInput = z.infer<typeof messageSearchRpcInputSchema>;
export type MessageSearchResponse = z.infer<typeof messageSearchResponseSchema>;
