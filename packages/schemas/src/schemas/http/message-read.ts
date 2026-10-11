import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { signalTextEnvelopeSchema } from "../protocol/envelope";

/** A requested count is a reading goal, not permission to exceed the page budget. */
export const messageReadQuerySchema = z.strictObject({
  spaceId: z.string().trim().min(1).max(256).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().min(1).max(8192).optional(),
  limit: z.coerce.number().int().min(1).max(1_000_000).default(30),
  maxBytes: z.coerce.number().int().min(2048).max(24_576).default(16_384),
  mode: z.enum(["preview", "full"]).default("preview"),
  fromProfileId: z.string().min(1).max(256).optional(),
  afterTs: z.coerce.number().int().nonnegative().optional(),
  beforeTs: z.coerce.number().int().nonnegative().optional(),
  threadId: z.string().min(1).max(256).optional(),
  signalId: z.string().min(1).max(256).optional(),
  includeSystem: z
    .union([z.boolean(), z.stringbool({ truthy: ["true"], falsy: ["false"] })])
    .default(false),
});

export const messageReadRpcInputSchema = messageReadQuerySchema.extend({
  context: openMeldRequestContextSchema,
});

export const messageReadItemSchema = z.strictObject({
  // A bounded read projection, not a complete publishable Signal envelope.
  signal: signalTextEnvelopeSchema
    .pick({
      v: true,
      id: true,
      spaceId: true,
      ts: true,
      profile: true,
    })
    .extend({
      type: z.enum(["signal.text", "signal.status", "signal.system_notice"]),
      data: z.object({
        text: z.string(),
        status: z.string().optional(),
        noticeType: z.string().optional(),
      }),
    }),
  threadRootSignalId: z.string().nullable(),
  spaceName: z.string().nullable(),
  directMessage: z.boolean(),
  centerAgent: z.boolean(),
  content: z.strictObject({
    version: z.string().min(1),
    offset: z.int().nonnegative(),
    nextOffset: z.int().nonnegative().nullable(),
    totalChars: z.int().nonnegative(),
    complete: z.boolean(),
  }),
});

export const messageReadPageSchema = z.strictObject({
  matches: z.array(messageReadItemSchema).max(100),
  nextCursor: z.string().nullable(),
  pageCursor: z.string().nullable(),
  indexing: z.boolean(),
  requestedCount: z.int().positive(),
  returnedCount: z.int().nonnegative(),
  completeCount: z.int().nonnegative(),
  limitBytes: z.int().positive(),
  order: z.literal("space_then_newest"),
  coverage: z.enum(["partial", "complete", "indexing"]),
});

/** Internal cursor data is validated again at the owner; it never grants access. */
export const spaceMessageReadCursorSchema = z.strictObject({
  version: z.literal(1),
  queryKey: z.string(),
  through: z.int().nonnegative(),
  before: z.int().positive().nullable(),
  offset: z.int().nonnegative().default(0),
  contentVersion: z.string().nullable().default(null),
});

export const workspaceMessageReadCursorSchema = z.strictObject({
  version: z.literal(1),
  queryKey: z.string(),
  afterSpaceId: z.string(),
  pendingSpaceId: z.string().nullable(),
  spaceCursor: z.string().nullable(),
  beforeTs: z.int().nonnegative(),
});

export type MessageReadQuery = z.infer<typeof messageReadQuerySchema>;
export type MessageReadRpcInput = z.infer<typeof messageReadRpcInputSchema>;
export type MessageReadItem = z.infer<typeof messageReadItemSchema>;
export type MessageReadPage = z.infer<typeof messageReadPageSchema>;
