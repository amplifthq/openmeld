import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { markCurrentSpaceInboxReadThrough } from "#/lib/organizations/inbox";
import {
	inboxQueryKeys,
	invalidateInboxFacts,
	spaceInboxSummaryQueryOptions,
	spaceInboxUnreadTargetsQueryOptions,
} from "#/query/organizations/inbox";
import {
	optimisticallyMarkSpaceInboxReadThrough,
	type SpaceInboxUnreadDestination,
} from "#/query/organizations/inbox-read-through-cache";
import { createSpaceInboxReadThroughCoordinator } from "./space-inbox-read-through-coordinator";

export type SpaceInboxReadPosition = {
	isReady: boolean;
	latestUnreadOccurredAtMs: number | null;
	markReadThrough: (
		throughOccurredAtMs: number,
		threadRootSignalId?: string
	) => Promise<void>;
	prepareCatchUpMain: () => Promise<PreparedSpaceInboxCatchUp | null>;
	targets: readonly SpaceInboxUnreadTarget[];
	totalUnreadCount: number;
};

export type PreparedSpaceInboxCatchUp = {
	abandon: () => void;
	commit: () => Promise<void>;
};

export function useSpaceInboxReadPosition(input: {
	destination: SpaceInboxUnreadDestination;
	organizationId: string | null;
	profileId: string;
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
	const summaryQuery = useQuery(
		spaceInboxSummaryQueryOptions({
			enabled: input.organizationId !== null,
			organizationId: input.organizationId ?? "",
		})
	);
	const summaryItem = summaryQuery.data?.spaces?.find(
		(space) => space.spaceId === input.spaceId
	);
	const persistOne = useCallback(
		async (throughOccurredAtMs: number, threadRootSignalId?: string) => {
			if (!(input.organizationId && throughOccurredAtMs > 0)) {
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
		[input.destination, input.organizationId, input.spaceId, queryClient]
	);
	const enqueuePersist = useMemo(
		() =>
			createSpaceInboxReadThroughCoordinator(
				async ({ threadRootSignalId, throughOccurredAtMs }) =>
					await persistOne(throughOccurredAtMs, threadRootSignalId)
			),
		[persistOne]
	);
	const persist = useCallback(
		async (throughOccurredAtMs: number, threadRootSignalId?: string) =>
			await enqueuePersist({
				...(threadRootSignalId ? { threadRootSignalId } : {}),
				throughOccurredAtMs,
			}),
		[enqueuePersist]
	);
	const retryCutoffRef = useRef<{
		cutoff: number;
		scopeKey: string;
	} | null>(null);
	const identityScopeKey = `${input.organizationId ?? ""}:${input.profileId}:${input.spaceId}`;
	const activeScopeKeyRef = useRef<string | null>(null);
	useEffect(() => {
		activeScopeKeyRef.current = identityScopeKey;
		retryCutoffRef.current = null;
		return () => {
			if (activeScopeKeyRef.current === identityScopeKey) {
				activeScopeKeyRef.current = null;
			}
		};
	}, [identityScopeKey]);
	const prepareCatchUpMain = useCallback(async () => {
		if (!input.organizationId) {
			return null;
		}
		const scopeKey = `${input.organizationId}:${input.profileId}:${input.spaceId}`;
		let preparedCutoff =
			retryCutoffRef.current?.scopeKey === scopeKey
				? retryCutoffRef.current
				: null;
		if (preparedCutoff === null) {
			const summary = await queryClient.fetchQuery({
				...spaceInboxSummaryQueryOptions({
					organizationId: input.organizationId,
				}),
				staleTime: 0,
			});
			if (scopeKey !== activeScopeKeyRef.current) {
				return null;
			}
			const space = summary.spaces.find(
				(candidate) => candidate.spaceId === input.spaceId
			);
			if (!space) {
				if ((unreadTargetsQuery.data?.totalUnreadCount ?? 0) > 0) {
					throw new Error(
						"OpenMeld couldn’t confirm which messages are unread. Try again."
					);
				}
				return null;
			}
			preparedCutoff = {
				cutoff: space.latestUnreadOccurredAtMs,
				scopeKey,
			};
			retryCutoffRef.current = preparedCutoff;
		}
		const cutoff = preparedCutoff;
		return {
			abandon: () => {
				if (retryCutoffRef.current === cutoff) {
					retryCutoffRef.current = null;
				}
			},
			commit: async () => {
				if (scopeKey !== activeScopeKeyRef.current) {
					return;
				}
				await persist(cutoff.cutoff);
				if (
					scopeKey === activeScopeKeyRef.current &&
					retryCutoffRef.current === cutoff
				) {
					retryCutoffRef.current = null;
				}
			},
		};
	}, [
		input.organizationId,
		input.profileId,
		input.spaceId,
		persist,
		queryClient,
		unreadTargetsQuery.data?.totalUnreadCount,
	]);
	return {
		isReady: unreadTargetsQuery.isSuccess,
		latestUnreadOccurredAtMs: summaryItem?.latestUnreadOccurredAtMs ?? null,
		markReadThrough: persist,
		prepareCatchUpMain,
		targets: unreadTargetsQuery.data?.targets ?? [],
		totalUnreadCount: unreadTargetsQuery.data?.totalUnreadCount ?? 0,
	};
}
