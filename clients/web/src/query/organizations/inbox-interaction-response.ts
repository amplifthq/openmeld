import type { SpaceInboxSummaryResponse } from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { inboxQueryKeys } from "./inbox";

// One owner-visible interaction produces one Inbox action. This changes only
// its presentation while the response is in flight, never execution authority.
export function optimisticallyRespondToSpaceInteraction(input: {
	organizationId: string;
	spaceId: string;
	queryClient: QueryClient;
}) {
	const key = inboxQueryKeys.spaceSummary(input.organizationId);
	const previous =
		input.queryClient.getQueryData<SpaceInboxSummaryResponse>(key);
	const attention = previous?.attention?.find(
		(item) => item.spaceId === input.spaceId
	);
	if (!(previous && attention?.unresolvedActionCount)) {
		return () => undefined;
	}
	const next: SpaceInboxSummaryResponse = {
		...previous,
		attention: previous.attention?.map((item) =>
			item === attention
				? { ...item, unresolvedActionCount: item.unresolvedActionCount - 1 }
				: item
		),
	};
	input.queryClient.setQueryData(key, next);
	const optimistic = input.queryClient.getQueryData(key);
	return () => {
		// A newer server snapshot must win over a failed request's old snapshot.
		if (input.queryClient.getQueryData(key) === optimistic) {
			input.queryClient.setQueryData(key, previous);
		}
	};
}
