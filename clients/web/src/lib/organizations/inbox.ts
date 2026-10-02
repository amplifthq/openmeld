import {
	createInboxApi,
	isInboxItemInOrganizationScope,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
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
	SpaceInboxSummaryResponse,
	SpaceInboxUnreadTargetsResponse,
	UpdateInboxMessageNotificationPreferencesBody,
	UpdateInboxNotificationPreferencesBody,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type InboxFailure = StructuredApiClientFailure;

function createWebInboxApi(organizationId: string) {
	return createInboxApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
}

export async function dismissCurrentInboxItem(input: {
	itemId: string;
	organizationId: string;
}): Promise<DismissInboxItemResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(input.organizationId).dismiss({
			itemId: input.itemId,
		});
		if (response.dismissedItemId !== input.itemId) {
			throw new Error("Inbox dismiss response item mismatch.");
		}
		return response;
	});
}

export async function listCurrentInboxFeed(
	input: InboxFeedQuery & { organizationId: string; signal?: AbortSignal }
): Promise<InboxFeedResponse> {
	return await runInboxOperation(async () => {
		const { organizationId, ...query } = input;
		const response = await createWebInboxApi(organizationId).feed(query);
		assertOrganizationMatch(response.organizationId, organizationId);
		return response;
	});
}

export async function mutateCurrentInboxFeed(
	input: MutateInboxFeedBody & { organizationId: string }
): Promise<MutateInboxFeedResponse> {
	return await runInboxOperation(async () => {
		const { organizationId, ...body } = input;
		return await createWebInboxApi(organizationId).mutateFeed(body);
	});
}

export async function observeCurrentInboxNotifications(
	input: InboxNotificationObservationsQuery & {
		organizationId: string;
		signal?: AbortSignal;
	}
): Promise<InboxNotificationObservationsResponse> {
	return await runInboxOperation(async () => {
		const { organizationId, ...query } = input;
		const response =
			await createWebInboxApi(organizationId).observeNotifications(query);
		assertOrganizationMatch(response.organizationId, organizationId);
		return response;
	});
}

export async function listCurrentInboxItems(input: {
	cursor?: string;
	limit?: number;
	organizationId: string;
	presentation?: InboxPresentation;
	signal?: AbortSignal;
	view?: InboxView;
}): Promise<ListInboxItemsResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(input.organizationId).list({
			cursor: input.cursor,
			limit: input.limit,
			presentation: input.presentation,
			signal: input.signal,
			view: input.view,
		});
		assertOrganizationMatch(response.organizationId, input.organizationId);
		return response;
	});
}

export async function getCurrentInboxItem(input: {
	itemId: string;
	organizationId: string;
	signal?: AbortSignal;
}): Promise<GetInboxItemResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(input.organizationId).get({
			itemId: input.itemId,
			signal: input.signal,
		});
		if (!isInboxItemInOrganizationScope(response.item, input.organizationId)) {
			throw new Error("Inbox response organization mismatch.");
		}
		return response;
	});
}

export async function getCurrentInboxSummary(input: {
	organizationId: string;
	presentation?: InboxPresentation;
	signal?: AbortSignal;
}): Promise<InboxSummaryResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(input.organizationId).summary({
			presentation: input.presentation,
			signal: input.signal,
		});
		assertOrganizationMatch(response.organizationId, input.organizationId);
		return response;
	});
}

export async function getCurrentCenterAgentInboxSummary(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<CenterAgentInboxSummaryResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(
			input.organizationId
		).centerAgentSummary({ signal: input.signal });
		assertOrganizationMatch(response.organizationId, input.organizationId);
		return response;
	});
}

export async function getCurrentSpaceInboxSummary(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<SpaceInboxSummaryResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(input.organizationId).spaceSummary(
			{
				signal: input.signal,
			}
		);
		assertOrganizationMatch(response.organizationId, input.organizationId);
		return response;
	});
}

export async function getCurrentSpaceInboxUnreadTargets(input: {
	organizationId: string;
	signal?: AbortSignal;
	spaceId: string;
}): Promise<SpaceInboxUnreadTargetsResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(
			input.organizationId
		).spaceUnreadTargets({
			signal: input.signal,
			spaceId: input.spaceId,
			includeItemIds: true,
		});
		assertOrganizationMatch(response.organizationId, input.organizationId);
		if (response.spaceId !== input.spaceId) {
			throw new Error("Space Inbox unread targets response Space mismatch.");
		}
		return response;
	});
}

export async function markCurrentCenterAgentInboxReadThrough(input: {
	organizationId: string;
	spaceId: string;
	throughOccurredAtMs: number;
}): Promise<MarkCenterAgentInboxReadThroughResponse> {
	return await runInboxOperation(async () =>
		createWebInboxApi(input.organizationId).markCenterAgentReadThrough({
			spaceId: input.spaceId,
			throughOccurredAtMs: input.throughOccurredAtMs,
		})
	);
}

export async function markCurrentSpaceInboxReadThrough(input: {
	organizationId: string;
	spaceId: string;
	threadRootSignalId?: string;
	throughOccurredAtMs: number;
}): Promise<MarkSpaceInboxReadThroughResponse> {
	return await runInboxOperation(async () =>
		createWebInboxApi(input.organizationId).markSpaceReadThrough({
			spaceId: input.spaceId,
			...(input.threadRootSignalId
				? { threadRootSignalId: input.threadRootSignalId }
				: {}),
			throughOccurredAtMs: input.throughOccurredAtMs,
		})
	);
}

export async function markCurrentInboxItemRead(input: {
	itemId: string;
	organizationId: string;
	read: boolean;
}): Promise<MarkInboxItemReadResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(input.organizationId).markRead({
			itemId: input.itemId,
			read: input.read,
		});
		if (!isInboxItemInOrganizationScope(response.item, input.organizationId)) {
			throw new Error("Inbox response organization mismatch.");
		}
		return response;
	});
}

export async function markAllCurrentInboxItemsRead(input: {
	organizationId: string;
	presentation?: InboxPresentation;
}): Promise<MarkAllInboxItemsReadResponse> {
	return await runInboxOperation(async () =>
		createWebInboxApi(input.organizationId).markAllRead({
			presentation: input.presentation,
		})
	);
}

export async function getCurrentInboxNotificationPreferences(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<InboxNotificationPreferencesResponse> {
	return await runInboxOperation(async () =>
		createWebInboxApi(input.organizationId).getPreferences({
			signal: input.signal,
		})
	);
}

export async function updateCurrentInboxNotificationPreferences(
	input: UpdateInboxNotificationPreferencesBody & { organizationId: string }
): Promise<InboxNotificationPreferencesResponse> {
	return await runInboxOperation(async () =>
		createWebInboxApi(input.organizationId).updatePreferences({
			urgentEmailEnabled: input.urgentEmailEnabled,
		})
	);
}

export async function getCurrentInboxMessageNotificationPreferences(input: {
	organizationId: string;
	spaceId?: string;
	signal?: AbortSignal;
}): Promise<InboxMessageNotificationPreferencesResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(
			input.organizationId
		).getMessageNotificationPreferences({
			spaceId: input.spaceId,
			signal: input.signal,
		});
		assertOrganizationMatch(response.organizationId, input.organizationId);
		if (response.spaceId !== (input.spaceId ?? null)) {
			throw new Error(
				"Message notification preferences conversation mismatch."
			);
		}
		return response;
	});
}

export async function updateCurrentInboxMessageNotificationPreferences(input: {
	organizationId: string;
	preference: UpdateInboxMessageNotificationPreferencesBody;
}): Promise<InboxMessageNotificationPreferencesResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(
			input.organizationId
		).updateMessageNotificationPreferences({ preference: input.preference });
		assertOrganizationMatch(response.organizationId, input.organizationId);
		const spaceId =
			input.preference.scope === "conversation"
				? input.preference.spaceId
				: null;
		if (response.spaceId !== spaceId) {
			throw new Error(
				"Message notification preferences conversation mismatch."
			);
		}
		return response;
	});
}

async function runInboxOperation<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

function assertOrganizationMatch(actual: string, expected: string): void {
	if (actual !== expected) {
		throw new Error("Inbox response organization mismatch.");
	}
}

export async function mutateCurrentSpaceInboxRead(input: {
	organizationId: string;
	body: MutateSpaceInboxReadBody;
}) {
	return await runInboxOperation(() =>
		createWebInboxApi(input.organizationId).mutateSpaceRead({
			body: input.body,
		})
	);
}
