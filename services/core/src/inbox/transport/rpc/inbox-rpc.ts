import {
  centerAgentInboxSummaryResponseSchema,
  dismissInboxItemResponseSchema,
  dismissInboxItemRpcInputSchema,
  getCenterAgentInboxSummaryRpcInputSchema,
  getInboxItemResponseSchema,
  getInboxItemRpcInputSchema,
  getInboxMessageNotificationPreferencesRpcInputSchema,
  getInboxNotificationPreferencesRpcInputSchema,
  getInboxSummaryRpcInputSchema,
  getSpaceInboxSummaryRpcInputSchema,
  getSpaceInboxUnreadTargetsRpcInputSchema,
  inboxFeedResponseSchema,
  inboxMessageNotificationPreferencesResponseSchema,
  inboxNotificationPreferencesResponseSchema,
  inboxSummaryResponseSchema,
  listInboxFeedRpcInputSchema,
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
  mutateInboxFeedResponseSchema,
  mutateInboxFeedRpcInputSchema,
  spaceInboxSummaryResponseSchema,
  spaceInboxUnreadTargetsResponseSchema,
  updateInboxMessageNotificationPreferencesRpcInputSchema,
  updateInboxNotificationPreferencesRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentInboxSummaryResponse,
  DismissInboxItemResponse,
  DismissInboxItemRpcInput,
  GetCenterAgentInboxSummaryRpcInput,
  GetInboxItemResponse,
  GetInboxItemRpcInput,
  GetInboxMessageNotificationPreferencesRpcInput,
  GetInboxNotificationPreferencesRpcInput,
  GetInboxSummaryRpcInput,
  GetSpaceInboxSummaryRpcInput,
  GetSpaceInboxUnreadTargetsRpcInput,
  InboxFeedResponse,
  InboxItem,
  InboxNotificationPreferencesResponse,
  InboxSummaryResponse,
  ListInboxFeedRpcInput,
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
  MutateInboxFeedResponse,
  MutateInboxFeedRpcInput,
  SpaceInboxSummaryResponse,
  SpaceInboxUnreadTargetsResponse,
  UpdateInboxMessageNotificationPreferencesRpcInput,
  UpdateInboxNotificationPreferencesRpcInput,
} from "@openmeld/schemas/types";
import { type CoreBindings, inboxDb } from "../../../lib/bindings";
import { reconcileInvitationInbox } from "../../../organizations/invitation-inbox-projection";
import { resolveActiveOrganizationMembership } from "../../../organizations/organization-context";
import { createCoreRpcHttpError } from "../../../rpc/errors";
import { createInboxFeedService } from "../../application/inbox-feed-service";
import { createInboxMessageNotificationPreferencesService } from "../../application/inbox-message-notification-preferences";
import {
  createInboxService,
  InboxServiceError,
} from "../../application/inbox-service";

export async function rpcListInboxFeed(
  env: CoreBindings,
  input: ListInboxFeedRpcInput
): Promise<InboxFeedResponse> {
  const { context, ...query } = parseRequest(
    listInboxFeedRpcInputSchema,
    input
  );
  const prepared = await prepareRequest(env, context);
  await reconcileInvitationInbox(prepared.db, prepared.organizationId);
  return parseResponse(
    inboxFeedResponseSchema,
    await runService(() =>
      createInboxFeedService({
        db: prepared.db,
        canManageOrganization: prepared.canManageOrganization,
      }).list(
        {
          organizationId: prepared.organizationId,
          recipientUserId: prepared.userId,
        },
        query
      )
    )
  );
}

export async function rpcMutateInboxFeed(
  env: CoreBindings,
  input: MutateInboxFeedRpcInput
): Promise<MutateInboxFeedResponse> {
  const { context, ...body } = parseRequest(
    mutateInboxFeedRpcInputSchema,
    input
  );
  const prepared = await prepareRequest(env, context);
  return parseResponse(
    mutateInboxFeedResponseSchema,
    await runService(() =>
      createInboxFeedService({
        db: prepared.db,
        canManageOrganization: prepared.canManageOrganization,
      }).mutate(
        {
          organizationId: prepared.organizationId,
          recipientUserId: prepared.userId,
        },
        body
      )
    )
  );
}

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
  await reconcileInvitationInbox(prepared.db, prepared.organizationId);
  return parseResponse(
    listInboxItemsResponseSchema,
    await runService(() =>
      prepared.service
        .list({
          cursor: request.cursor,
          limit: request.limit,
          notificationPreview: request.notificationPreview === "true",
          organizationId: prepared.organizationId,
          ...(request.presentation === undefined
            ? {}
            : { presentation: request.presentation }),
          recipientUserId: prepared.userId,
          view: request.view,
        })
        .then((response) => ({
          ...response,
          items: response.items.map((item) =>
            projectReplyToRecipientForReceiver(
              item,
              request.includeReplyToRecipient,
              request.includeSourceFacts
            )
          ),
        }))
    )
  );
}

export async function rpcGetInboxItem(
  env: CoreBindings,
  input: GetInboxItemRpcInput
): Promise<GetInboxItemResponse> {
  const request = parseRequest(getInboxItemRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  await reconcileInvitationInbox(prepared.db, prepared.organizationId);
  return parseResponse(
    getInboxItemResponseSchema,
    await runService(() =>
      prepared.service
        .get({
          itemId: request.itemId,
          organizationId: prepared.organizationId,
          recipientUserId: prepared.userId,
        })
        .then((response) => ({
          item: projectReplyToRecipientForReceiver(
            response.item,
            request.includeReplyToRecipient,
            request.includeSourceFacts
          ),
        }))
    )
  );
}

export async function rpcGetInboxSummary(
  env: CoreBindings,
  input: GetInboxSummaryRpcInput
): Promise<InboxSummaryResponse> {
  const request = parseRequest(getInboxSummaryRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  await reconcileInvitationInbox(prepared.db, prepared.organizationId);
  return parseResponse(
    inboxSummaryResponseSchema,
    await runService(() =>
      prepared.service.summary({
        organizationId: prepared.organizationId,
        ...(request.presentation === undefined
          ? {}
          : { presentation: request.presentation }),
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

export async function rpcGetSpaceInboxUnreadTargets(
  env: CoreBindings,
  input: GetSpaceInboxUnreadTargetsRpcInput
): Promise<SpaceInboxUnreadTargetsResponse> {
  const request = parseRequest(getSpaceInboxUnreadTargetsRpcInputSchema, input);
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    spaceInboxUnreadTargetsResponseSchema,
    await runService(() =>
      prepared.service.spaceUnreadTargets({
        organizationId: prepared.organizationId,
        recipientUserId: prepared.userId,
        spaceId: request.spaceId,
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
        ...(request.threadRootSignalId === undefined
          ? {}
          : { threadRootSignalId: request.threadRootSignalId }),
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
      prepared.service
        .markRead({
          itemId: request.itemId,
          organizationId: prepared.organizationId,
          read: request.read,
          recipientUserId: prepared.userId,
        })
        .then((response) => ({
          item: projectReplyToRecipientForReceiver(
            response.item,
            request.includeReplyToRecipient,
            request.includeSourceFacts
          ),
        }))
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
        ...(request.presentation === undefined
          ? {}
          : { presentation: request.presentation }),
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

export async function rpcGetInboxMessageNotificationPreferences(
  env: CoreBindings,
  input: GetInboxMessageNotificationPreferencesRpcInput
) {
  const request = parseRequest(
    getInboxMessageNotificationPreferencesRpcInputSchema,
    input
  );
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    inboxMessageNotificationPreferencesResponseSchema,
    await runService(() =>
      createInboxMessageNotificationPreferencesService(prepared.db).get({
        userId: prepared.userId,
        organizationId: prepared.organizationId,
        spaceId: request.spaceId,
      })
    )
  );
}

export async function rpcUpdateInboxMessageNotificationPreferences(
  env: CoreBindings,
  input: UpdateInboxMessageNotificationPreferencesRpcInput
) {
  const request = parseRequest(
    updateInboxMessageNotificationPreferencesRpcInputSchema,
    input
  );
  const prepared = await prepareRequest(env, request.context);
  return parseResponse(
    inboxMessageNotificationPreferencesResponseSchema,
    await runService(() =>
      createInboxMessageNotificationPreferencesService(prepared.db).update({
        userId: prepared.userId,
        organizationId: prepared.organizationId,
        preference: request.preference,
      })
    )
  );
}

/** Older Gateway receivers have a strict target parser. Keep their RPC shape
 * unchanged even after Core starts persisting recipient-specific reply facts. */
function projectReplyToRecipientForReceiver(
  item: InboxItem,
  includeReplyToRecipient?: boolean,
  includeSourceFacts?: boolean
): InboxItem {
  const { sourceFacts: _sourceFacts, ...legacyItem } = item;
  const compatibleItem = includeSourceFacts === true ? item : legacyItem;
  if (
    includeReplyToRecipient === true ||
    compatibleItem.sourceTarget.kind !== "space"
  ) {
    return compatibleItem;
  }
  const { replyToRecipient: _replyToRecipient, ...sourceTarget } =
    compatibleItem.sourceTarget;
  return { ...compatibleItem, sourceTarget };
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
    db,
    organizationId: membership.organizationId,
    canManageOrganization:
      membership.role === "owner" || membership.role === "admin",
    service: createInboxService({
      db,
      canManageOrganization:
        membership.role === "owner" || membership.role === "admin",
    }),
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
