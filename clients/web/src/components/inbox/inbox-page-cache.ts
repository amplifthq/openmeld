import type {
	GetInboxItemResponse,
	InboxItem,
	InboxSummaryResponse,
	ListInboxItemsResponse,
} from "@openmeld/schemas/types";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { inboxQueryKeys } from "#/query/organizations/inbox";

export type InboxCacheSnapshots = {
	items: ReturnType<typeof captureInboxItemSnapshots>;
	lists: ReturnType<typeof captureInboxListSnapshots>;
	summary: InboxSummaryResponse | undefined;
};

export function captureInboxCacheSnapshots(
	queryClient: QueryClient,
	organizationId: string
): InboxCacheSnapshots {
	return {
		items: captureInboxItemSnapshots(queryClient, organizationId),
		lists: captureInboxListSnapshots(queryClient, organizationId),
		summary: queryClient.getQueryData<InboxSummaryResponse>(
			inboxQueryKeys.summary(organizationId)
		),
	};
}

export function restoreInboxCacheSnapshots(
	queryClient: QueryClient,
	context: InboxCacheSnapshots | undefined
) {
	if (!context) {
		return;
	}
	for (const [queryKey, data] of context.lists) {
		queryClient.setQueryData(queryKey, data);
	}
	for (const [queryKey, data] of context.items) {
		queryClient.setQueryData(queryKey, data);
	}
	if (context.summary) {
		queryClient.setQueryData(
			inboxQueryKeys.summary(context.summary.organizationId),
			context.summary
		);
	}
}

export function updateCachedInboxItem(input: {
	itemId: string;
	organizationId: string;
	queryClient: QueryClient;
	update: (item: InboxItem) => InboxItem;
}) {
	updateAllCachedInboxItems({
		organizationId: input.organizationId,
		queryClient: input.queryClient,
		update: (item) => (item.id === input.itemId ? input.update(item) : item),
	});
}

export function updateAllCachedInboxItems(input: {
	organizationId: string;
	queryClient: QueryClient;
	update: (item: InboxItem) => InboxItem;
}) {
	const lists = input.queryClient.getQueriesData<
		InfiniteData<ListInboxItemsResponse>
	>({ queryKey: inboxQueryKeys.lists(input.organizationId) });
	for (const [queryKey, current] of lists) {
		if (!current) {
			continue;
		}
		const isUnreadView = queryKey.at(-1) === "unread";
		input.queryClient.setQueryData<InfiniteData<ListInboxItemsResponse>>(
			queryKey,
			{
				...current,
				pages: current.pages.map((page) => {
					const updatedItems = page.items.map(input.update);
					return {
						...page,
						items: isUnreadView
							? updatedItems.filter((item) => item.readAt === null)
							: updatedItems,
					};
				}),
			}
		);
	}
	const itemDetails = input.queryClient.getQueriesData<GetInboxItemResponse>({
		queryKey: inboxQueryKeys.items(input.organizationId),
	});
	for (const [queryKey, current] of itemDetails) {
		if (current) {
			input.queryClient.setQueryData<GetInboxItemResponse>(queryKey, {
				...current,
				item: input.update(current.item),
			});
		}
	}
}

export function updateCachedInboxUnreadCount(input: {
	delta: number;
	organizationId: string;
	queryClient: QueryClient;
}) {
	input.queryClient.setQueryData<InboxSummaryResponse>(
		inboxQueryKeys.summary(input.organizationId),
		(current) =>
			current
				? {
						...current,
						totalUnreadCount: Math.max(
							0,
							current.totalUnreadCount + input.delta
						),
					}
				: current
	);
}

export function removeCachedInboxItem(input: {
	item: InboxItem;
	organizationId: string;
	queryClient: QueryClient;
}) {
	const lists = input.queryClient.getQueriesData<
		InfiniteData<ListInboxItemsResponse>
	>({ queryKey: inboxQueryKeys.lists(input.organizationId) });
	for (const [queryKey, current] of lists) {
		if (!current) {
			continue;
		}
		input.queryClient.setQueryData<InfiniteData<ListInboxItemsResponse>>(
			queryKey,
			{
				...current,
				pages: current.pages.map((page) => ({
					...page,
					items: page.items.filter((item) => item.id !== input.item.id),
				})),
			}
		);
	}
	input.queryClient.removeQueries({
		exact: true,
		queryKey: inboxQueryKeys.item(input.organizationId, input.item.id),
	});
	input.queryClient.setQueryData<InboxSummaryResponse>(
		inboxQueryKeys.summary(input.organizationId),
		(current) =>
			current
				? {
						...current,
						totalUnreadCount: Math.max(
							0,
							current.totalUnreadCount - (input.item.readAt === null ? 1 : 0)
						),
						unresolvedActionCount: Math.max(
							0,
							current.unresolvedActionCount -
								(input.item.attention === "action_required" &&
								input.item.resolutionStatus === "open"
									? 1
									: 0)
						),
					}
				: current
	);
}

function captureInboxListSnapshots(
	queryClient: QueryClient,
	organizationId: string
) {
	return queryClient.getQueriesData<InfiniteData<ListInboxItemsResponse>>({
		queryKey: inboxQueryKeys.lists(organizationId),
	});
}

function captureInboxItemSnapshots(
	queryClient: QueryClient,
	organizationId: string
) {
	return queryClient.getQueriesData<GetInboxItemResponse>({
		queryKey: inboxQueryKeys.items(organizationId),
	});
}
