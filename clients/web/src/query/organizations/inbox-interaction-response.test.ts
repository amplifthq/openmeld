import type { SpaceInboxSummaryResponse } from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { inboxQueryKeys } from "./inbox";
import { optimisticallyRespondToSpaceInteraction } from "./inbox-interaction-response";

it.each([
	1, 2,
])("removes one of %i actions without clearing unrelated attention", (count) => {
	const queryClient = new QueryClient();
	const key = inboxQueryKeys.spaceSummary("org");
	const previous: SpaceInboxSummaryResponse = {
		organizationId: "org",
		spaces: [{ spaceId: "a", unreadCount: 3, latestUnreadOccurredAtMs: 10 }],
		attention: [
			{
				spaceId: "a",
				unresolvedActionCount: count,
				unreadUrgentUpdateCount: 1,
			},
			{ spaceId: "b", unresolvedActionCount: 2, unreadUrgentUpdateCount: 0 },
		],
	};
	queryClient.setQueryData(key, previous);
	const rollback = optimisticallyRespondToSpaceInteraction({
		organizationId: "org",
		spaceId: "a",
		queryClient,
	});
	expect(queryClient.getQueryData(key)).toEqual({
		...previous,
		attention: [
			{ ...previous.attention?.[0], unresolvedActionCount: count - 1 },
			previous.attention?.[1],
		],
	});
	rollback();
	expect(queryClient.getQueryData(key)).toEqual(previous);
	const rollbackAgain = optimisticallyRespondToSpaceInteraction({
		organizationId: "org",
		spaceId: "a",
		queryClient,
	});
	const newer = { ...previous, attention: [] };
	queryClient.setQueryData(key, newer);
	rollbackAgain();
	expect(queryClient.getQueryData(key)).toEqual(newer);
});
