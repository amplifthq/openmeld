import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
	readSpaceUpdates,
	type SpaceHistorySnapshot,
	writeSpaceHistoryEnvelopesToCache,
} from "./history";
import { spaceQueryKeys } from "./status";

type Conversation = { spaceId: string; openMeldProfileId: string };

// Share in-flight reads across navigation, prefetch and the mounted feed.
// Completed reads stay stale so they cannot satisfy a later subscription.
export function spaceUpdatesQueryOptions(
	input: Conversation & { afterSignalId: string }
) {
	return queryOptions({
		queryKey: [
			"spaces",
			"updates",
			input.spaceId,
			input.openMeldProfileId,
			input.afterSignalId,
		],
		queryFn: ({ signal }) => readSpaceUpdates({ ...input, signal }),
		staleTime: 0,
		gcTime: 30_000,
		retry: false,
	});
}

export async function fetchSpaceUpdatesAfterSubscription(
	queryClient: QueryClient,
	input: Conversation & { afterSignalId: string }
) {
	const options = spaceUpdatesQueryOptions(input);
	if (queryClient.getQueryState(options.queryKey)?.fetchStatus === "fetching") {
		await queryClient.fetchQuery(options);
	}
	// Never let a pre-subscription read satisfy the ready acknowledgement.
	return await queryClient.fetchQuery(options);
}

export function spaceHistoryPrefetchQueryOptions(
	queryClient: QueryClient,
	input: Conversation
) {
	return queryOptions({
		queryKey: [
			"spaces",
			"history-prefetch",
			input.spaceId,
			input.openMeldProfileId,
		],
		staleTime: 5000,
		gcTime: 30_000,
		retry: false,
		queryFn: async ({ signal }) => {
			const historyKey = spaceQueryKeys.history(
				input.spaceId,
				input.openMeldProfileId
			);
			const historyQuery = queryClient
				.getQueryCache()
				.find({ queryKey: historyKey, exact: true });
			const history =
				queryClient.getQueryData<SpaceHistorySnapshot>(historyKey);
			const anchor = history?.envelopes.at(-1)?.id;
			if (!(historyQuery && anchor)) {
				return null;
			}
			const updates = await queryClient.fetchQuery(
				spaceUpdatesQueryOptions({
					...input,
					afterSignalId: anchor,
				})
			);
			// Auth/access cleanup may remove and recreate the same key while reading.
			// A speculative read must never resurrect its former conversation.
			if (
				signal.aborted ||
				queryClient
					.getQueryCache()
					.find({ queryKey: historyKey, exact: true }) !== historyQuery
			) {
				return null;
			}
			writeSpaceHistoryEnvelopesToCache({
				...input,
				queryClient,
				envelopes: updates.signals,
			});
			return null;
		},
	});
}
