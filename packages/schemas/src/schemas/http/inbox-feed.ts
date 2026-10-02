import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { INBOX_LIST_MAX_LIMIT, inboxItemSchema } from "./inbox";

const opaqueKeySchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/u);
const identifierSchema = z.string().trim().min(1).max(256);
const countSchema = z.number().int().nonnegative();

export const inboxFeedCategorySchema = z.enum([
  "all",
  "mentions",
  "needs_action",
  "needs_review",
]);
export const inboxFeedQuerySchema = z.strictObject({
  category: inboxFeedCategorySchema.optional(),
  unreadOnly: z.enum(["true", "false"]).optional(),
  agentsOnly: z.enum(["true", "false"]).optional(),
  peopleOnly: z.enum(["true", "false"]).optional(),
  conversationType: z.enum(["all", "direct_messages", "spaces"]).optional(),
  includeSelectionUnreadCount: z.literal("true").optional(),
  cursor: z.string().min(1).max(8192).optional(),
  limit: z.coerce.number().int().min(1).max(INBOX_LIST_MAX_LIMIT).optional(),
  snapshotId: identifierSchema.optional(),
  groupKey: opaqueKeySchema.optional(),
  grouping: z.literal("space").optional(),
});
export const inboxFeedCountsSchema = z.strictObject({
  all: countSchema,
  mentions: countSchema,
  needsAction: countSchema,
  needsReview: countSchema,
  unread: countSchema,
  priority: countSchema,
});
export const inboxFeedRowSchema = z.strictObject({
  groupKey: opaqueKeySchema,
  item: inboxItemSchema,
  itemCount: z.number().int().positive(),
  unreadCount: countSchema,
  latestOccurredAt: z.iso.datetime({ offset: true }),
  section: z.enum(["priority", "open", "activity"]),
  requestCategory: z.enum(["action", "review"]).nullable(),
  dot: z.enum(["blue", "yellow"]).nullable(),
  group: z
    .strictObject({
      kind: z.enum(["space", "system", "conversation"]),
      conversationCount: countSchema,
    })
    .optional(),
});
export const inboxFeedResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  snapshotId: identifierSchema,
  snapshotExpiresAt: z.iso.datetime({ offset: true }),
  counts: inboxFeedCountsSchema,
  selectionUnreadCount: countSchema.optional(),
  rows: z.array(inboxFeedRowSchema).max(INBOX_LIST_MAX_LIMIT),
  nextCursor: z.string().nullable(),
});
export const mutateInboxFeedBodySchema = z.strictObject({
  snapshotId: identifierSchema,
  groupKey: opaqueKeySchema.optional(),
  operation: z.enum(["read", "dismiss"]),
});
export const mutateInboxFeedResponseSchema = z.strictObject({
  changedCount: countSchema,
});
export const listInboxFeedRpcInputSchema = inboxFeedQuerySchema.extend({
  context: openMeldRequestContextSchema,
});
export const mutateInboxFeedRpcInputSchema = mutateInboxFeedBodySchema.extend({
  context: openMeldRequestContextSchema,
});
