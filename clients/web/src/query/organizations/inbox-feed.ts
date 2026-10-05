import type {
	InboxFeedCategory,
	InboxFeedQuery,
	MutateInboxFeedBody,
} from "@openmeld/schemas/types";
import {
	infiniteQueryOptions,
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import {
	listCurrentInboxFeed,
	mutateCurrentInboxFeed,
} from "#/lib/organizations/inbox";
import { ROUTE_REVISIT_GC_TIME_MS } from "#/query/query-config";
import { inboxQueryKeys, invalidateInboxFacts } from "./inbox";

export type InboxFeedFilters = {
	category: InboxFeedCategory;
	unreadOnly: boolean;
	agentsOnly: boolean;
	peopleOnly?: boolean;
	conversationType?: InboxFeedQuery["conversationType"];
	grouping?: InboxFeedQuery["grouping"];
};

export function organizationInboxFeedQueryOptions(
	input: InboxFeedFilters & {
		organizationId: string;
		accountId: string;
		snapshotId?: string;
		groupKey?: string;
		limit?: number;
	}
) {
	const query: InboxFeedQuery = {
		category: input.category,
		grouping: input.grouping,
		includeSelectionUnreadCount: "true",
		unreadOnly: input.unreadOnly ? "true" : "false",
		agentsOnly: input.agentsOnly ? "true" : "false",
		peopleOnly: input.peopleOnly ? "true" : undefined,
		conversationType:
			input.conversationType === "all" ? undefined : input.conversationType,
		limit: input.limit ?? 40,
		snapshotId: input.snapshotId,
		groupKey: input.groupKey,
	};
	return infiniteQueryOptions({
		queryKey: [
			...inboxQueryKeys.feeds(input.organizationId),
			input.accountId,
			query,
		],
		queryFn: ({ pageParam, signal }) =>
			listCurrentInboxFeed({
				...query,
				organizationId: input.organizationId,
				cursor: pageParam,
				signal,
			}),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		staleTime: 10_000,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
	});
}

export function useOrganizationInboxFeed(
	input: Parameters<typeof organizationInboxFeedQueryOptions>[0] & {
		enabled?: boolean;
	}
) {
	return useInfiniteQuery({
		...organizationInboxFeedQueryOptions(input),
		enabled:
			(input.enabled ?? true) &&
			Boolean(input.organizationId && input.accountId),
		refetchInterval: input.groupKey ? false : 30_000,
		refetchIntervalInBackground: false,
	});
}

export function useMutateOrganizationInboxFeed(organizationId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: MutateInboxFeedBody) =>
			mutateCurrentInboxFeed({ ...body, organizationId }),
		onSuccess: () => invalidateInboxFacts({ queryClient, organizationId }),
	});
}
