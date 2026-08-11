import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { markCurrentSpaceInboxReadThrough } from "#/lib/organizations/inbox";
import { invalidateInboxFacts } from "#/query/organizations/inbox";

export function useSpaceInboxReadPosition(input: {
	organizationId: string | null;
	spaceId: string;
}) {
	const queryClient = useQueryClient();
	return useCallback(
		async (throughOccurredAtMs: number) => {
			if (!(input.organizationId && throughOccurredAtMs > 0)) {
				return;
			}
			await markCurrentSpaceInboxReadThrough({
				organizationId: input.organizationId,
				spaceId: input.spaceId,
				throughOccurredAtMs,
			});
			await invalidateInboxFacts({
				organizationId: input.organizationId,
				queryClient,
			});
		},
		[input.organizationId, input.spaceId, queryClient]
	);
}
