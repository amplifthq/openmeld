import type { z } from "zod/v4";

type InboxFeedSchemas = typeof import("../../schemas/http/inbox-feed");

export type InboxFeedCategory = z.infer<
  InboxFeedSchemas["inboxFeedCategorySchema"]
>;
export type InboxFeedQuery = z.infer<InboxFeedSchemas["inboxFeedQuerySchema"]>;
export type InboxFeedCounts = z.infer<
  InboxFeedSchemas["inboxFeedCountsSchema"]
>;
export type InboxFeedRow = z.infer<InboxFeedSchemas["inboxFeedRowSchema"]>;
export type InboxFeedResponse = z.infer<
  InboxFeedSchemas["inboxFeedResponseSchema"]
>;
export type MutateInboxFeedBody = z.infer<
  InboxFeedSchemas["mutateInboxFeedBodySchema"]
>;
export type MutateInboxFeedResponse = z.infer<
  InboxFeedSchemas["mutateInboxFeedResponseSchema"]
>;
export type ListInboxFeedRpcInput = z.infer<
  InboxFeedSchemas["listInboxFeedRpcInputSchema"]
>;
export type MutateInboxFeedRpcInput = z.infer<
  InboxFeedSchemas["mutateInboxFeedRpcInputSchema"]
>;
