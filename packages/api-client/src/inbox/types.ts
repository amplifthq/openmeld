import type {
  CenterAgentInboxSummaryResponse,
  DismissInboxItemResponse,
  GetInboxItemResponse,
  InboxFeedQuery,
  InboxFeedResponse,
  InboxMessageNotificationPreferencesResponse,
  InboxNotificationObservationsQuery,
  InboxNotificationObservationsResponse,
  InboxNotificationPreferencesResponse,
  InboxPresentation,
  InboxSummaryResponse,
  InboxView,
  ListInboxItemsResponse,
  MarkAllInboxItemsReadResponse,
  MarkCenterAgentInboxReadThroughResponse,
  MarkInboxItemReadResponse,
  MarkSpaceInboxReadThroughResponse,
  MutateInboxFeedBody,
  MutateInboxFeedResponse,
  MutateSpaceInboxReadBody,
  MutateSpaceInboxReadResponse,
  OpenMeldRequestContext,
  SpaceInboxSummaryResponse,
  SpaceInboxUnreadTargetsResponse,
  UpdateInboxMessageNotificationPreferencesBody,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type InboxRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type InboxApi = {
  mutateSpaceRead: (
    input: InboxRequestInput & { body: MutateSpaceInboxReadBody }
  ) => Promise<MutateSpaceInboxReadResponse>;
  observeNotifications: (
    input?: InboxRequestInput & InboxNotificationObservationsQuery
  ) => Promise<InboxNotificationObservationsResponse>;
  feed: (
    input?: InboxRequestInput & InboxFeedQuery
  ) => Promise<InboxFeedResponse>;
  mutateFeed: (
    input: InboxRequestInput & MutateInboxFeedBody
  ) => Promise<MutateInboxFeedResponse>;
  getMessageNotificationPreferences: (
    input?: InboxRequestInput & { spaceId?: string }
  ) => Promise<InboxMessageNotificationPreferencesResponse>;
  updateMessageNotificationPreferences: (
    input: InboxRequestInput & {
      preference: UpdateInboxMessageNotificationPreferencesBody;
    }
  ) => Promise<InboxMessageNotificationPreferencesResponse>;
  centerAgentSummary: (
    input?: InboxRequestInput
  ) => Promise<CenterAgentInboxSummaryResponse>;
  markCenterAgentReadThrough: (
    input: InboxRequestInput & {
      spaceId: string;
      throughOccurredAtMs: number;
    }
  ) => Promise<MarkCenterAgentInboxReadThroughResponse>;
  spaceSummary: (
    input?: InboxRequestInput
  ) => Promise<SpaceInboxSummaryResponse>;
  spaceUnreadTargets: (
    input: InboxRequestInput & { spaceId: string; includeItemIds?: boolean }
  ) => Promise<SpaceInboxUnreadTargetsResponse>;
  markSpaceReadThrough: (
    input: InboxRequestInput & {
      spaceId: string;
      threadRootSignalId?: string;
      throughOccurredAtMs: number;
    }
  ) => Promise<MarkSpaceInboxReadThroughResponse>;
  dismiss: (
    input: InboxRequestInput & { itemId: string }
  ) => Promise<DismissInboxItemResponse>;
  get: (
    input: InboxRequestInput & { itemId: string }
  ) => Promise<GetInboxItemResponse>;
  list: (
    input?: InboxRequestInput & {
      cursor?: string;
      limit?: number;
      presentation?: InboxPresentation;
      notificationPreview?: "true";
      view?: InboxView;
    }
  ) => Promise<ListInboxItemsResponse>;
  summary: (
    input?: InboxRequestInput & { presentation?: InboxPresentation }
  ) => Promise<InboxSummaryResponse>;
  markRead: (
    input: InboxRequestInput & { itemId: string; read: boolean }
  ) => Promise<MarkInboxItemReadResponse>;
  markAllRead: (
    input?: InboxRequestInput & { presentation?: InboxPresentation }
  ) => Promise<MarkAllInboxItemsReadResponse>;
  getPreferences: (
    input?: InboxRequestInput
  ) => Promise<InboxNotificationPreferencesResponse>;
  updatePreferences: (
    input: InboxRequestInput & { urgentEmailEnabled: boolean }
  ) => Promise<InboxNotificationPreferencesResponse>;
};

export type CreateInboxApi = (client: OpenMeldApiClientFoundation) => InboxApi;
