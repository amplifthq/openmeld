import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useContext } from "react";
import { markCurrentSpaceInboxReadThrough } from "#/lib/organizations/inbox";
import {
	inboxQueryKeys,
	invalidateInboxFacts,
	spaceInboxUnreadTargetsQueryOptions,
} from "#/query/organizations/inbox";
import {
	optimisticallyMarkSpaceInboxReadThrough,
	type SpaceInboxUnreadDestination,
} from "#/query/organizations/inbox-read-through-cache";
import { SpaceReadTrackingContext } from "./space-read-tracking-context";

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
	destination: SpaceInboxUnreadDestination;
	organizationId: string | null;
	spaceId: string;
}): SpaceInboxReadPosition {
	const queryClient = useQueryClient();
	const readTrackingEnabled = useContext(SpaceReadTrackingContext);
	const unreadTargetsQuery = useQuery(
		spaceInboxUnreadTargetsQueryOptions({
			enabled: input.organizationId !== null,
			organizationId: input.organizationId ?? "",
			spaceId: input.spaceId,
		})
	);
	const persist = useCallback(
		async (throughOccurredAtMs: number, threadRootSignalId?: string) => {
			if (
				!(
					readTrackingEnabled &&
					input.organizationId &&
					throughOccurredAtMs > 0
				)
			) {
				return;
			}
			await queryClient.cancelQueries({
				queryKey: inboxQueryKeys.organization(input.organizationId),
			});
			const optimisticUpdate = optimisticallyMarkSpaceInboxReadThrough({
				destination: input.destination,
				organizationId: input.organizationId,
				queryClient,
				spaceId: input.spaceId,
				...(threadRootSignalId ? { threadRootSignalId } : {}),
				throughOccurredAtMs,
			});
			try {
				await markCurrentSpaceInboxReadThrough({
					organizationId: input.organizationId,
					spaceId: input.spaceId,
					...(threadRootSignalId ? { threadRootSignalId } : {}),
					throughOccurredAtMs,
				});
			} catch (error) {
				optimisticUpdate.rollback();
				try {
					await invalidateInboxFacts({
						organizationId: input.organizationId,
						queryClient,
					});
				} catch (refreshError) {
					console.warn(
						"Failed to refresh Inbox after a read-position write failed.",
						refreshError
					);
				}
				throw error;
			}
			await invalidateInboxFacts({
				organizationId: input.organizationId,
				queryClient,
			});
		},
		[
			input.destination,
			input.organizationId,
			input.spaceId,
			queryClient,
			readTrackingEnabled,
		]
	);
	return {
		isReady: unreadTargetsQuery.isSuccess,
		markReadThrough: persist,
		targets: unreadTargetsQuery.data?.targets ?? [],
		totalUnreadCount: unreadTargetsQuery.data?.totalUnreadCount ?? 0,
	};
}
