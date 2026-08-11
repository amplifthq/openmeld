import {
  centerAgentInboxSummaryResponseSchema,
  dismissInboxItemResponseSchema,
  dismissInboxItemRpcInputSchema,
  getCenterAgentInboxSummaryRpcInputSchema,
  getInboxItemResponseSchema,
  getInboxItemRpcInputSchema,
  getInboxNotificationPreferencesRpcInputSchema,
  getInboxSummaryRpcInputSchema,
  getSpaceInboxSummaryRpcInputSchema,
  inboxNotificationPreferencesResponseSchema,
  inboxSummaryResponseSchema,
  listInboxItemsResponseSchema,
  listInboxItemsRpcInputSchema,
  markAllInboxItemsReadResponseSchema,
  markAllInboxItemsReadRpcInputSchema,
  markCenterAgentInboxReadThroughResponseSchema,
  markCenterAgentInboxReadThroughRpcInputSchema,
  markInboxItemReadResponseSchema,
  markInboxItemReadRpcInputSchema,
  markSpaceInboxReadThroughResponseSchema,
  markSpaceInboxReadThroughRpcInputSchema,
  spaceInboxSummaryResponseSchema,
  updateInboxNotificationPreferencesRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentInboxSummaryResponse,
  DismissInboxItemResponse,
  DismissInboxItemRpcInput,
  GetCenterAgentInboxSummaryRpcInput,
  GetInboxItemResponse,
  GetInboxItemRpcInput,
  GetInboxNotificationPreferencesRpcInput,
  GetInboxSummaryRpcInput,
  GetSpaceInboxSummaryRpcInput,
  InboxNotificationPreferencesResponse,
  InboxSummaryResponse,
  ListInboxItemsResponse,
  ListInboxItemsRpcInput,
  MarkAllInboxItemsReadResponse,
  MarkAllInboxItemsReadRpcInput,
  MarkCenterAgentInboxReadThroughResponse,
  MarkCenterAgentInboxReadThroughRpcInput,
  MarkInboxItemReadResponse,
  MarkInboxItemReadRpcInput,
  MarkSpaceInboxReadThroughResponse,
  MarkSpaceInboxReadThroughRpcInput,
  SpaceInboxSummaryResponse,
  UpdateInboxNotificationPreferencesRpcInput,
} from "@openmeld/schemas/types";
import { type CoreBindings, inboxDb } from "../../../lib/bindings";
import { resolveActiveOrganizationMembership } from "../../../organizations/organization-context";
import { createCoreRpcHttpError } from "../../../rpc/errors";
import {
  createInboxService,
  InboxServiceError,
} from "../../application/inbox-service";

export async function rpcDismissInboxItem(
  env: CoreBindings,
  input: DismissInboxItemRpcInput
): Promise<DismissInboxItemResponse> {
  const request = parseRequest(dismissInboxItemRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    dismissInboxItemResponseSchema,
    await runService(() =>
      prepared.service.dismiss({
        itemId: request.itemId,
        organizationId: prepared.organizationId,
        recipientUserId: prepared.userId,
      })
    )
  );
}

export async function rpcListInboxItems(
  env: CoreBindings,
  input: ListInboxItemsRpcInput
): Promise<ListInboxItemsResponse> {
  const request = parseRequest(listInboxItemsRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    listInboxItemsResponseSchema,
    await runService(() =>
      prepared.service.list({
        cursor: request.cursor,
        limit: request.limit,
        organizationId: prepared.organizationId,
        recipientUserId: prepared.userId,
        view: request.view,
      })
    )
  );
}

export async function rpcGetInboxItem(
  env: CoreBindings,
  input: GetInboxItemRpcInput
): Promise<GetInboxItemResponse> {
  const request = parseRequest(getInboxItemRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    getInboxItemResponseSchema,
    await runService(() =>
      prepared.service.get({
        itemId: request.itemId,
        organizationId: prepared.organizationId,
        recipientUserId: prepared.userId,
      })
    )
  );
}

export async function rpcGetInboxSummary(
  env: CoreBindings,
  input: GetInboxSummaryRpcInput
): Promise<InboxSummaryResponse> {
  const request = parseRequest(getInboxSummaryRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    inboxSummaryResponseSchema,
    await runService(() =>
      prepared.service.summary({
        organizationId: prepared.organizationId,
        recipientUserId: prepared.userId,
      })
    )
  );
}

export async function rpcGetCenterAgentInboxSummary(
  env: CoreBindings,
  input: GetCenterAgentInboxSummaryRpcInput
): Promise<CenterAgentInboxSummaryResponse> {
  const request = parseRequest(getCenterAgentInboxSummaryRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    centerAgentInboxSummaryResponseSchema,
    await runService(() =>
      prepared.service.centerAgentSummary({
        organizationId: prepared.organizationId,
        recipientUserId: prepared.userId,
      })
    )
  );
}

export async function rpcGetSpaceInboxSummary(
  env: CoreBindings,
  input: GetSpaceInboxSummaryRpcInput
): Promise<SpaceInboxSummaryResponse> {
  const request = parseRequest(getSpaceInboxSummaryRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    spaceInboxSummaryResponseSchema,
    await runService(() =>
      prepared.service.spaceSummary({
        organizationId: prepared.organizationId,
        recipientUserId: prepared.userId,
      })
    )
  );
}

export async function rpcMarkCenterAgentInboxReadThrough(
  env: CoreBindings,
  input: MarkCenterAgentInboxReadThroughRpcInput
): Promise<MarkCenterAgentInboxReadThroughResponse> {
  const request = parseRequest(
    markCenterAgentInboxReadThroughRpcInputSchema,
    input
  );
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    markCenterAgentInboxReadThroughResponseSchema,
    await runService(() =>
      prepared.service.markCenterAgentReadThrough({
        organizationId: prepared.organizationId,
        recipientUserId: prepared.userId,
        spaceId: request.spaceId,
        throughOccurredAtMs: request.throughOccurredAtMs,
      })
    )
  );
}

export async function rpcMarkSpaceInboxReadThrough(
  env: CoreBindings,
  input: MarkSpaceInboxReadThroughRpcInput
): Promise<MarkSpaceInboxReadThroughResponse> {
  const request = parseRequest(markSpaceInboxReadThroughRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    markSpaceInboxReadThroughResponseSchema,
    await runService(() =>
      prepared.service.markSpaceReadThrough({
        organizationId: prepared.organizationId,
        recipientUserId: prepared.userId,
        spaceId: request.spaceId,
        throughOccurredAtMs: request.throughOccurredAtMs,
      })
    )
  );
}

export async function rpcMarkInboxItemRead(
  env: CoreBindings,
  input: MarkInboxItemReadRpcInput
): Promise<MarkInboxItemReadResponse> {
  const request = parseRequest(markInboxItemReadRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    markInboxItemReadResponseSchema,
    await runService(() =>
      prepared.service.markRead({
        itemId: request.itemId,
        organizationId: prepared.organizationId,
        read: request.read,
        recipientUserId: prepared.userId,
      })
    )
  );
}

export async function rpcMarkAllInboxItemsRead(
  env: CoreBindings,
  input: MarkAllInboxItemsReadRpcInput
): Promise<MarkAllInboxItemsReadResponse> {
  const request = parseRequest(markAllInboxItemsReadRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    markAllInboxItemsReadResponseSchema,
    await runService(() =>
      prepared.service.markAllRead({
        organizationId: prepared.organizationId,
        recipientUserId: prepared.userId,
      })
    )
  );
}

export async function rpcGetInboxNotificationPreferences(
  env: CoreBindings,
  input: GetInboxNotificationPreferencesRpcInput
): Promise<InboxNotificationPreferencesResponse> {
  const request = parseRequest(
    getInboxNotificationPreferencesRpcInputSchema,
    input
  );
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    inboxNotificationPreferencesResponseSchema,
    await runService(() =>
      prepared.service.getPreferences({ userId: prepared.userId })
    )
  );
}

export async function rpcUpdateInboxNotificationPreferences(
  env: CoreBindings,
  input: UpdateInboxNotificationPreferencesRpcInput
): Promise<InboxNotificationPreferencesResponse> {
  const request = parseRequest(
    updateInboxNotificationPreferencesRpcInputSchema,
    input
  );
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    inboxNotificationPreferencesResponseSchema,
    await runService(() =>
      prepared.service.updatePreferences({
        urgentEmailEnabled: request.urgentEmailEnabled,
        userId: prepared.userId,
      })
    )
  );
}

async function prepareRequest(
  env: CoreBindings,
  context: ListInboxItemsRpcInput["context"]
) {
  const membership = await resolveActiveOrganizationMembership({
    context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  const db = inboxDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "inbox.store_unavailable",
      reason: "Inbox is temporarily unavailable.",
      status: 503,
    });
  }
  return {
    organizationId: membership.organizationId,
    service: createInboxService({ db }),
    userId: membership.userId,
  };
}

async function runService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InboxServiceError) {
      throw createCoreRpcHttpError({
        code: error.code,
        reason: error.message,
        status: error.status,
      });
    }
    throw error;
  }
}

function parseRequest<T>(
  schema: {
    safeParse(value: unknown): { data: T; success: true } | { success: false };
  },
  input: unknown
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Inbox request is invalid.",
      status: 400,
    });
  }
  return parsed.data;
}

function parseResponse<T>(
  schema: {
    safeParse(value: unknown): { data: T; success: true } | { success: false };
  },
  value: unknown
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Failed to build a valid Inbox response.");
  }
  return parsed.data;
}
