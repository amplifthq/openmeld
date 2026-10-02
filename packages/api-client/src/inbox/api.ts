import {
  OPENMELD_HEADER_INBOX_ITEM_KIND_VERSION,
  OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION,
  OPENMELD_HEADER_INBOX_SUMMARY_VERSION,
  OPENMELD_INBOX_ITEM_KIND_VERSION,
  OPENMELD_INBOX_SOURCE_TARGET_VERSION,
  OPENMELD_INBOX_SUMMARY_VERSION,
} from "@openmeld/gateway-contract";
import {
  centerAgentInboxSummaryResponseSchema,
  dismissInboxItemResponseSchema,
  getInboxItemResponseSchema,
  inboxFeedQuerySchema,
  inboxFeedResponseSchema,
  inboxItemRouteParamsSchema,
  inboxMessageNotificationPreferencesQuerySchema,
  inboxMessageNotificationPreferencesResponseSchema,
  inboxNotificationObservationsQuerySchema,
  inboxNotificationObservationsResponseSchema,
  inboxNotificationPreferencesResponseSchema,
  inboxSummaryQuerySchema,
  inboxSummaryResponseSchema,
  listInboxItemsQuerySchema,
  listInboxItemsResponseSchema,
  markAllInboxItemsReadQuerySchema,
  markAllInboxItemsReadResponseSchema,
  markCenterAgentInboxReadThroughBodySchema,
  markCenterAgentInboxReadThroughResponseSchema,
  markInboxItemReadBodySchema,
  markInboxItemReadResponseSchema,
  markSpaceInboxReadThroughBodySchema,
  markSpaceInboxReadThroughResponseSchema,
  mutateInboxFeedBodySchema,
  mutateInboxFeedResponseSchema,
  spaceInboxSummaryResponseSchema,
  spaceInboxUnreadTargetsResponseSchema,
  spaceInboxUnreadTargetsRouteParamsSchema,
  updateInboxMessageNotificationPreferencesBodySchema,
  updateInboxNotificationPreferencesBodySchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildCenterAgentInboxReadThroughPath,
  buildCenterAgentInboxSummaryPath,
  buildInboxFeedPath,
  buildInboxFeedStatePath,
  buildInboxItemDismissPath,
  buildInboxItemPath,
  buildInboxItemReadPath,
  buildInboxMarkAllReadPath,
  buildInboxMessageNotificationPreferencesPath,
  buildInboxNotificationObservationsPath,
  buildInboxPath,
  buildInboxPreferencesPath,
  buildInboxSummaryPath,
  buildSpaceInboxReadThroughPath,
  buildSpaceInboxSummaryPath,
  buildSpaceInboxUnreadTargetsPath,
} from "./routes";
import type { CreateInboxApi, InboxRequestInput } from "./types";

export const createInboxApi: CreateInboxApi = (
  client: OpenMeldApiClientFoundation
) => ({
  observeNotifications: async (input = {}) => {
    const query = requireValidInput(
      inboxNotificationObservationsQuerySchema,
      { cursor: input.cursor, limit: input.limit },
      "Inbox notification observation request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      method: "GET",
      operation: "inbox.notification_observations",
      headers: inboxSourceTargetVersionHeaders(),
      schema: inboxNotificationObservationsResponseSchema,
      invalidMessage: "Invalid Inbox notification observation response",
      url: buildInboxNotificationObservationsPath(query),
    });
  },
  feed: async (input = {}) => {
    const {
      requestContext: _context,
      signal: _signal,
      timeoutMs: _timeout,
      ...rawQuery
    } = input;
    const query = requireValidInput(
      inboxFeedQuerySchema,
      rawQuery,
      "Inbox filters are invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      method: "GET",
      operation: "inbox.feed",
      headers: inboxSourceTargetVersionHeaders(),
      schema: inboxFeedResponseSchema,
      invalidMessage: "Invalid Inbox attention feed response",
      url: buildInboxFeedPath(query),
    });
  },
  mutateFeed: async (input) => {
    const body = requireValidInput(
      mutateInboxFeedBodySchema,
      {
        snapshotId: input.snapshotId,
        groupKey: input.groupKey,
        operation: input.operation,
      },
      "Inbox selection is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      method: "POST",
      operation: "inbox.feed.state",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      schema: mutateInboxFeedResponseSchema,
      invalidMessage: "Invalid Inbox selection response",
      url: buildInboxFeedStatePath(),
    });
  },
  getMessageNotificationPreferences: async (input = {}) => {
    const query = requireValidInput(
      inboxMessageNotificationPreferencesQuerySchema,
      { spaceId: input.spaceId },
      "Message notification preferences query is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      method: "GET",
      operation: "inbox.message_preferences.read",
      invalidMessage: "Invalid message notification preferences response",
      schema: inboxMessageNotificationPreferencesResponseSchema,
      url: buildInboxMessageNotificationPreferencesPath(query.spaceId),
    });
  },
  updateMessageNotificationPreferences: async (input) => {
    const body = requireValidInput(
      updateInboxMessageNotificationPreferencesBodySchema,
      input.preference,
      "Message notification preferences request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      method: "PATCH",
      operation: "inbox.message_preferences.update",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "Invalid message notification preferences response",
      schema: inboxMessageNotificationPreferencesResponseSchema,
      url: buildInboxMessageNotificationPreferencesPath(),
    });
  },
  centerAgentSummary: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Center Agent Inbox summary response",
      method: "GET",
      operation: "inbox.center_agent.summary",
      schema: centerAgentInboxSummaryResponseSchema,
      url: buildCenterAgentInboxSummaryPath(),
    }),
  dismiss: async (input) => {
    const params = requireValidInput(
      inboxItemRouteParamsSchema,
      { itemId: input.itemId },
      "Inbox item request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Inbox dismiss response",
      headers: inboxSourceTargetVersionHeaders(),
      method: "PUT",
      operation: "inbox.item.dismiss",
      schema: dismissInboxItemResponseSchema,
      url: buildInboxItemDismissPath(params.itemId),
    });
  },
  get: async (input) => {
    const params = requireValidInput(
      inboxItemRouteParamsSchema,
      { itemId: input.itemId },
      "Inbox item request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      headers: inboxSourceTargetVersionHeaders(),
      invalidMessage: "invalid Inbox item response",
      method: "GET",
      operation: "inbox.item.get",
      schema: getInboxItemResponseSchema,
      url: buildInboxItemPath(params.itemId),
    });
  },
  list: async (input = {}) => {
    const query = requireValidInput(
      listInboxItemsQuerySchema,
      {
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.presentation === undefined
          ? {}
          : { presentation: input.presentation }),
        ...(input.notificationPreview === undefined
          ? {}
          : { notificationPreview: input.notificationPreview }),
        ...(input.view === undefined ? {} : { view: input.view }),
      },
      "Inbox list request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      headers: inboxSourceTargetVersionHeaders(),
      invalidMessage: "invalid Inbox list response",
      method: "GET",
      operation: "inbox.list",
      schema: listInboxItemsResponseSchema,
      url: buildInboxPath(query),
    });
  },
  summary: async (input = {}) => {
    const query = requireValidInput(
      inboxSummaryQuerySchema,
      input.presentation === undefined
        ? {}
        : { presentation: input.presentation },
      "Inbox summary request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Inbox summary response",
      headers: {
        ...inboxSourceTargetVersionHeaders(),
        [OPENMELD_HEADER_INBOX_SUMMARY_VERSION]: OPENMELD_INBOX_SUMMARY_VERSION,
      },
      method: "GET",
      operation: "inbox.summary",
      schema: inboxSummaryResponseSchema,
      url: buildInboxSummaryPath(query.presentation),
    });
  },
  markRead: async (input) => {
    const params = requireValidInput(
      inboxItemRouteParamsSchema,
      { itemId: input.itemId },
      "Inbox item request is invalid."
    );
    const body = requireValidInput(
      markInboxItemReadBodySchema,
      { read: input.read },
      "Inbox read request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...inboxSourceTargetVersionHeaders(),
      },
      invalidMessage: "invalid Inbox read response",
      method: "PATCH",
      operation: "inbox.item.read",
      schema: markInboxItemReadResponseSchema,
      url: buildInboxItemReadPath(params.itemId),
    });
  },
  markAllRead: async (input = {}) => {
    const query = requireValidInput(
      markAllInboxItemsReadQuerySchema,
      input.presentation === undefined
        ? {}
        : { presentation: input.presentation },
      "Inbox mark-all-read request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Inbox mark-all-read response",
      method: "POST",
      operation: "inbox.mark_all_read",
      schema: markAllInboxItemsReadResponseSchema,
      url: buildInboxMarkAllReadPath(query.presentation),
    });
  },
  markCenterAgentReadThrough: async (input) => {
    const body = requireValidInput(
      markCenterAgentInboxReadThroughBodySchema,
      {
        spaceId: input.spaceId,
        throughOccurredAtMs: input.throughOccurredAtMs,
      },
      "Center Agent Inbox read request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Center Agent Inbox read response",
      method: "POST",
      operation: "inbox.center_agent.read_through",
      schema: markCenterAgentInboxReadThroughResponseSchema,
      url: buildCenterAgentInboxReadThroughPath(),
    });
  },
  spaceSummary: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Space Inbox summary response",
      method: "GET",
      operation: "inbox.space.summary",
      headers: {
        ...inboxSourceTargetVersionHeaders(),
        [OPENMELD_HEADER_INBOX_SUMMARY_VERSION]: OPENMELD_INBOX_SUMMARY_VERSION,
      },
      schema: spaceInboxSummaryResponseSchema,
      url: buildSpaceInboxSummaryPath(),
    }),
  spaceUnreadTargets: async (input) => {
    const params = requireValidInput(
      spaceInboxUnreadTargetsRouteParamsSchema,
      { spaceId: input.spaceId },
      "Space Inbox unread targets request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      headers: inboxSourceTargetVersionHeaders(),
      invalidMessage: "invalid Space Inbox unread targets response",
      method: "GET",
      operation: "inbox.space.unread_targets",
      schema: spaceInboxUnreadTargetsResponseSchema,
      url: buildSpaceInboxUnreadTargetsPath(params.spaceId),
    });
  },
  markSpaceReadThrough: async (input) => {
    const body = requireValidInput(
      markSpaceInboxReadThroughBodySchema,
      {
        spaceId: input.spaceId,
        ...(input.threadRootSignalId === undefined
          ? {}
          : { threadRootSignalId: input.threadRootSignalId }),
        throughOccurredAtMs: input.throughOccurredAtMs,
      },
      "Space Inbox read request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Space Inbox read response",
      method: "POST",
      operation: "inbox.space.read_through",
      schema: markSpaceInboxReadThroughResponseSchema,
      url: buildSpaceInboxReadThroughPath(),
    });
  },
  getPreferences: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Inbox notification preferences response",
      method: "GET",
      operation: "inbox.preferences.read",
      schema: inboxNotificationPreferencesResponseSchema,
      url: buildInboxPreferencesPath(),
    }),
  updatePreferences: async (input) => {
    const body = requireValidInput(
      updateInboxNotificationPreferencesBodySchema,
      { urgentEmailEnabled: input.urgentEmailEnabled },
      "Inbox notification preferences request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Inbox notification preferences response",
      method: "PATCH",
      operation: "inbox.preferences.update",
      schema: inboxNotificationPreferencesResponseSchema,
      url: buildInboxPreferencesPath(),
    });
  },
});

function inboxSourceTargetVersionHeaders(): Record<string, string> {
  return {
    [OPENMELD_HEADER_INBOX_ITEM_KIND_VERSION]: OPENMELD_INBOX_ITEM_KIND_VERSION,
    [OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION]:
      OPENMELD_INBOX_SOURCE_TARGET_VERSION,
  };
}

function requestOptions(input: InboxRequestInput): {
  requestContext?: InboxRequestInput["requestContext"];
  signal?: AbortSignal;
  timeoutMs?: number;
} {
  return {
    ...(input.requestContext === undefined
      ? {}
      : { requestContext: input.requestContext }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function requireValidInput<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { issues: Array<{ message: string }> }; success: false };
  },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${message} ${parsed.error.issues[0]?.message ?? "Invalid input."}`
    );
  }
  return parsed.data;
}
