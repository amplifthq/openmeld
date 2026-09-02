import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { markCurrentSpaceInboxReadThrough } from "#/lib/organizations/inbox";
import {
	invalidateInboxFacts,
	spaceInboxUnreadTargetsQueryOptions,
} from "#/query/organizations/inbox";

export type SpaceInboxReadPosition = {
	isReady: boolean;
	markReadThrough: (
		throughOccurredAtMs: number,
		threadRootSignalId?: string
	) => Promise<void>;
	targets: readonly SpaceInboxUnreadTarget[];
	totalUnreadCount: number;
};

export function useSpaceInboxReadPosition(input: {
	organizationId: string | null;
	spaceId: string;
}): SpaceInboxReadPosition {
	const queryClient = useQueryClient();
	const unreadTargetsQuery = useQuery(
		spaceInboxUnreadTargetsQueryOptions({
			enabled: input.organizationId !== null,
			organizationId: input.organizationId ?? "",
			spaceId: input.spaceId,
		})
	);
	const persist = useCallback(
		async (throughOccurredAtMs: number, threadRootSignalId?: string) => {
			if (!(input.organizationId && throughOccurredAtMs > 0)) {
				return;
			}
			await markCurrentSpaceInboxReadThrough({
				organizationId: input.organizationId,
				spaceId: input.spaceId,
				...(threadRootSignalId ? { threadRootSignalId } : {}),
				throughOccurredAtMs,
			});
			await invalidateInboxFacts({
				organizationId: input.organizationId,
				queryClient,
			});
		},
		[input.organizationId, input.spaceId, queryClient]
	);
	return {
		isReady: unreadTargetsQuery.isSuccess,
		markReadThrough: persist,
		targets: unreadTargetsQuery.data?.targets ?? [],
		totalUnreadCount: unreadTargetsQuery.data?.totalUnreadCount ?? 0,
	};
}
