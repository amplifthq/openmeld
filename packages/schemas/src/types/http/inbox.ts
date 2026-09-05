import type { z } from "zod/v4";

type InboxSchemas = typeof import("../../schemas/http/inbox");

export type InboxView = z.infer<InboxSchemas["inboxViewSchema"]>;
export type InboxAttention = z.infer<InboxSchemas["inboxAttentionSchema"]>;
export type InboxImportance = z.infer<InboxSchemas["inboxImportanceSchema"]>;
export type InboxResolutionStatus = z.infer<
  InboxSchemas["inboxResolutionStatusSchema"]
>;
export type InboxItemKind = z.infer<InboxSchemas["inboxItemKindSchema"]>;
export type InboxSourceKind = z.infer<InboxSchemas["inboxSourceKindSchema"]>;
export type CenterAgentAttentionImpact = z.infer<
  InboxSchemas["centerAgentAttentionImpactSchema"]
>;
export type CenterAgentRequestMemberAttentionBody = z.infer<
  InboxSchemas["centerAgentRequestMemberAttentionBodySchema"]
>;
export type CenterAgentRequestMemberAttentionResponse = z.infer<
  InboxSchemas["centerAgentRequestMemberAttentionResponseSchema"]
>;
export type InboxSourceTarget = z.infer<
  InboxSchemas["inboxSourceTargetSchema"]
>;
export type InboxItem = z.infer<InboxSchemas["inboxItemSchema"]>;
export type ListInboxItemsQuery = z.infer<
  InboxSchemas["listInboxItemsQuerySchema"]
>;
export type ListInboxItemsResponse = z.infer<
  InboxSchemas["listInboxItemsResponseSchema"]
>;
export type InboxSummaryResponse = z.infer<
  InboxSchemas["inboxSummaryResponseSchema"]
>;
export type CenterAgentInboxSummaryResponse = z.infer<
  InboxSchemas["centerAgentInboxSummaryResponseSchema"]
>;
export type SpaceInboxSummaryItem = z.infer<
  InboxSchemas["spaceInboxSummaryItemSchema"]
>;
export type SpaceInboxSummaryResponse = z.infer<
  InboxSchemas["spaceInboxSummaryResponseSchema"]
>;
export type SpaceInboxUnreadTarget = z.infer<
  InboxSchemas["spaceInboxUnreadTargetSchema"]
>;
export type SpaceInboxUnreadTargetsResponse = z.infer<
  InboxSchemas["spaceInboxUnreadTargetsResponseSchema"]
>;
export type SpaceInboxUnreadTargetsRouteParams = z.infer<
  InboxSchemas["spaceInboxUnreadTargetsRouteParamsSchema"]
>;
export type MarkCenterAgentInboxReadThroughBody = z.infer<
  InboxSchemas["markCenterAgentInboxReadThroughBodySchema"]
>;
export type MarkCenterAgentInboxReadThroughResponse = z.infer<
  InboxSchemas["markCenterAgentInboxReadThroughResponseSchema"]
>;
export type MarkSpaceInboxReadThroughBody = z.infer<
  InboxSchemas["markSpaceInboxReadThroughBodySchema"]
>;
export type MarkSpaceInboxReadThroughResponse = z.infer<
  InboxSchemas["markSpaceInboxReadThroughResponseSchema"]
>;
export type InboxNotificationPreferencesResponse = z.infer<
  InboxSchemas["inboxNotificationPreferencesResponseSchema"]
>;
export type UpdateInboxNotificationPreferencesBody = z.infer<
  InboxSchemas["updateInboxNotificationPreferencesBodySchema"]
>;
export type InboxItemRouteParams = z.infer<
  InboxSchemas["inboxItemRouteParamsSchema"]
>;
export type GetInboxItemResponse = z.infer<
  InboxSchemas["getInboxItemResponseSchema"]
>;
export type DismissInboxItemResponse = z.infer<
  InboxSchemas["dismissInboxItemResponseSchema"]
>;
export type MarkInboxItemReadBody = z.infer<
  InboxSchemas["markInboxItemReadBodySchema"]
>;
export type MarkInboxItemReadResponse = z.infer<
  InboxSchemas["markInboxItemReadResponseSchema"]
>;
export type MarkAllInboxItemsReadResponse = z.infer<
  InboxSchemas["markAllInboxItemsReadResponseSchema"]
>;
export type InboxSourceCandidate = z.infer<
  InboxSchemas["inboxSourceCandidateSchema"]
>;
export type ListInboxItemsRpcInput = z.infer<
  InboxSchemas["listInboxItemsRpcInputSchema"]
>;
export type GetInboxSummaryRpcInput = z.infer<
  InboxSchemas["getInboxSummaryRpcInputSchema"]
>;
export type GetCenterAgentInboxSummaryRpcInput = z.infer<
  InboxSchemas["getCenterAgentInboxSummaryRpcInputSchema"]
>;
export type GetSpaceInboxSummaryRpcInput = z.infer<
  InboxSchemas["getSpaceInboxSummaryRpcInputSchema"]
>;
export type GetSpaceInboxUnreadTargetsRpcInput = z.infer<
  InboxSchemas["getSpaceInboxUnreadTargetsRpcInputSchema"]
>;
export type MarkCenterAgentInboxReadThroughRpcInput = z.infer<
  InboxSchemas["markCenterAgentInboxReadThroughRpcInputSchema"]
>;
export type MarkSpaceInboxReadThroughRpcInput = z.infer<
  InboxSchemas["markSpaceInboxReadThroughRpcInputSchema"]
>;
export type GetInboxItemRpcInput = z.infer<
  InboxSchemas["getInboxItemRpcInputSchema"]
>;
export type DismissInboxItemRpcInput = z.infer<
  InboxSchemas["dismissInboxItemRpcInputSchema"]
>;
export type MarkInboxItemReadRpcInput = z.infer<
  InboxSchemas["markInboxItemReadRpcInputSchema"]
>;
export type MarkAllInboxItemsReadRpcInput = z.infer<
  InboxSchemas["markAllInboxItemsReadRpcInputSchema"]
>;
export type GetInboxNotificationPreferencesRpcInput = z.infer<
  InboxSchemas["getInboxNotificationPreferencesRpcInputSchema"]
>;
export type UpdateInboxNotificationPreferencesRpcInput = z.infer<
  InboxSchemas["updateInboxNotificationPreferencesRpcInputSchema"]
>;
export type CenterAgentRequestMemberAttentionRpcInput = z.infer<
  InboxSchemas["centerAgentRequestMemberAttentionRpcInputSchema"]
>;
