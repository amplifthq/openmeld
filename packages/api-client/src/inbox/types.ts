import type {
  CenterAgentInboxSummaryResponse,
  DismissInboxItemResponse,
  GetInboxItemResponse,
  InboxNotificationPreferencesResponse,
  InboxSummaryResponse,
  InboxView,
  ListInboxItemsResponse,
  MarkAllInboxItemsReadResponse,
  MarkCenterAgentInboxReadThroughResponse,
  MarkInboxItemReadResponse,
  MarkSpaceInboxReadThroughResponse,
  OpenMeldRequestContext,
  SpaceInboxSummaryResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type InboxRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type InboxApi = {
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
  markSpaceReadThrough: (
    input: InboxRequestInput & {
      spaceId: string;
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
      view?: InboxView;
    }
  ) => Promise<ListInboxItemsResponse>;
  summary: (input?: InboxRequestInput) => Promise<InboxSummaryResponse>;
  markRead: (
    input: InboxRequestInput & { itemId: string; read: boolean }
  ) => Promise<MarkInboxItemReadResponse>;
  markAllRead: (
    input?: InboxRequestInput
  ) => Promise<MarkAllInboxItemsReadResponse>;
  getPreferences: (
    input?: InboxRequestInput
  ) => Promise<InboxNotificationPreferencesResponse>;
  updatePreferences: (
    input: InboxRequestInput & { urgentEmailEnabled: boolean }
  ) => Promise<InboxNotificationPreferencesResponse>;
};

export type CreateInboxApi = (client: OpenMeldApiClientFoundation) => InboxApi;
