import {
	createInboxApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
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
	SpaceInboxSummaryResponse,
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

export async function listCurrentInboxItems(input: {
	cursor?: string;
	limit?: number;
	organizationId: string;
	signal?: AbortSignal;
	view?: InboxView;
}): Promise<ListInboxItemsResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(input.organizationId).list({
			cursor: input.cursor,
			limit: input.limit,
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
		assertOrganizationMatch(response.item.organizationId, input.organizationId);
		return response;
	});
}

export async function getCurrentInboxSummary(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<InboxSummaryResponse> {
	return await runInboxOperation(async () => {
		const response = await createWebInboxApi(input.organizationId).summary({
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
	throughOccurredAtMs: number;
}): Promise<MarkSpaceInboxReadThroughResponse> {
	return await runInboxOperation(async () =>
		createWebInboxApi(input.organizationId).markSpaceReadThrough({
			spaceId: input.spaceId,
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
		assertOrganizationMatch(response.item.organizationId, input.organizationId);
		return response;
	});
}

export async function markAllCurrentInboxItemsRead(input: {
	organizationId: string;
}): Promise<MarkAllInboxItemsReadResponse> {
	return await runInboxOperation(async () =>
		createWebInboxApi(input.organizationId).markAllRead()
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
