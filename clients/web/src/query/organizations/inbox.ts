import type {
	CenterAgentInboxSummaryResponse,
	GetInboxItemResponse,
	InboxNotificationPreferencesResponse,
	InboxSummaryResponse,
	InboxView,
	ListInboxItemsResponse,
	SpaceInboxSummaryResponse,
} from "@openmeld/schemas/types";
import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import {
	getCurrentCenterAgentInboxSummary,
	getCurrentInboxItem,
	getCurrentInboxNotificationPreferences,
	getCurrentInboxSummary,
	getCurrentSpaceInboxSummary,
	type InboxFailure,
	listCurrentInboxItems,
} from "#/lib/organizations/inbox";
import { baseQueryOptions } from "#/query/query-config";

export const INBOX_PAGE_LIMIT = 50;
export const INBOX_LIST_POLL_INTERVAL_MS = 15_000;
export const INBOX_SUMMARY_POLL_INTERVAL_MS = 15_000;

export const inboxQueryKeys = {
	all: ["inbox"] as const,
	organization: (organizationId: string) =>
		[...inboxQueryKeys.all, organizationId] as const,
	lists: (organizationId: string) =>
		[...inboxQueryKeys.organization(organizationId), "list"] as const,
	list: (organizationId: string, view: InboxView) =>
		[...inboxQueryKeys.lists(organizationId), view] as const,
	items: (organizationId: string) =>
		[...inboxQueryKeys.organization(organizationId), "item"] as const,
	item: (organizationId: string, itemId: string) =>
		[...inboxQueryKeys.items(organizationId), itemId] as const,
	summary: (organizationId: string) =>
		[...inboxQueryKeys.organization(organizationId), "summary"] as const,
	centerAgentSummary: (organizationId: string) =>
		[
			...inboxQueryKeys.organization(organizationId),
			"center-agent-summary",
		] as const,
	spaceSummary: (organizationId: string) =>
		[...inboxQueryKeys.organization(organizationId), "space-summary"] as const,
	preferences: (userId: string) =>
		[...inboxQueryKeys.all, "preferences", "account", userId] as const,
};

export function inboxItemQueryOptions(input: {
	enabled?: boolean;
	itemId: string;
	organizationId: string;
}) {
	return queryOptions<GetInboxItemResponse, InboxFailure>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await getCurrentInboxItem({
				itemId: input.itemId,
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: inboxQueryKeys.item(input.organizationId, input.itemId),
		refetchOnWindowFocus: true,
		retry: (failureCount, error) =>
			error.status === 404
				? false
				: baseQueryOptions.retry(failureCount, error),
		staleTime: 10_000,
	});
}

export function inboxBrowserNotificationRecoveryItemQueryOptions(input: {
	itemId: string;
	organizationId: string;
}) {
	return queryOptions<GetInboxItemResponse, InboxFailure>({
		...inboxItemQueryOptions(input),
		staleTime: 0,
	});
}

export function inboxItemsInfiniteQueryOptions(input: {
	enabled?: boolean;
	organizationId: string;
	view: InboxView;
}) {
	return infiniteQueryOptions<
		ListInboxItemsResponse,
		InboxFailure,
		InfiniteData<ListInboxItemsResponse, string | undefined>,
		ReturnType<typeof inboxQueryKeys.list>,
		string | undefined
	>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		initialPageParam: undefined,
		queryFn: async ({ pageParam, signal }) =>
			await listCurrentInboxItems({
				cursor: pageParam,
				limit: INBOX_PAGE_LIMIT,
				organizationId: input.organizationId,
				signal,
				view: input.view,
			}),
		queryKey: inboxQueryKeys.list(input.organizationId, input.view),
		refetchInterval: INBOX_LIST_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function inboxSummaryQueryOptions(input: {
	enabled?: boolean;
	organizationId: string;
}) {
	return queryOptions<InboxSummaryResponse, InboxFailure>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await getCurrentInboxSummary({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: inboxQueryKeys.summary(input.organizationId),
		refetchInterval: INBOX_SUMMARY_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function centerAgentInboxSummaryQueryOptions(input: {
	enabled?: boolean;
	organizationId: string;
}) {
	return queryOptions<CenterAgentInboxSummaryResponse, InboxFailure>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await getCurrentCenterAgentInboxSummary({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: inboxQueryKeys.centerAgentSummary(input.organizationId),
		refetchInterval: INBOX_SUMMARY_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function spaceInboxSummaryQueryOptions(input: {
	enabled?: boolean;
	organizationId: string;
}) {
	return queryOptions<SpaceInboxSummaryResponse, InboxFailure>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await getCurrentSpaceInboxSummary({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: inboxQueryKeys.spaceSummary(input.organizationId),
		refetchInterval: INBOX_SUMMARY_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function inboxNotificationPreferencesQueryOptions(input: {
	enabled?: boolean;
	organizationId: string;
	userId: string;
}) {
	return queryOptions<InboxNotificationPreferencesResponse, InboxFailure>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await getCurrentInboxNotificationPreferences({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: inboxQueryKeys.preferences(input.userId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 30_000,
	});
}

export async function invalidateInboxFacts(input: {
	organizationId: string;
	queryClient: QueryClient;
}): Promise<void> {
	await Promise.all([
		input.queryClient.invalidateQueries({
			queryKey: inboxQueryKeys.lists(input.organizationId),
		}),
		input.queryClient.invalidateQueries({
			queryKey: inboxQueryKeys.summary(input.organizationId),
		}),
		input.queryClient.invalidateQueries({
			queryKey: inboxQueryKeys.centerAgentSummary(input.organizationId),
		}),
		input.queryClient.invalidateQueries({
			queryKey: inboxQueryKeys.spaceSummary(input.organizationId),
		}),
		input.queryClient.invalidateQueries({
			queryKey: inboxQueryKeys.items(input.organizationId),
		}),
	]);
}

export async function invalidateInboxSummary(input: {
	organizationId: string;
	queryClient: QueryClient;
}): Promise<void> {
	await input.queryClient.invalidateQueries({
		queryKey: inboxQueryKeys.summary(input.organizationId),
	});
}
