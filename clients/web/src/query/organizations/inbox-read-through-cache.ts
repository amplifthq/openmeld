import type {
	CenterAgentInboxSummaryResponse,
	InboxSummaryResponse,
	SpaceInboxSummaryResponse,
	SpaceInboxUnreadTarget,
	SpaceInboxUnreadTargetsResponse,
} from "@openmeld/schemas/types";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { inboxQueryKeys } from "./inbox";

export type SpaceInboxUnreadDestination =
	| "center-agent"
	| "direct-message"
	| "ordinary-space";

type Rollback = () => void;

export function optimisticallyMarkSpaceInboxReadThrough(input: {
	destination: SpaceInboxUnreadDestination;
	organizationId: string;
	queryClient: QueryClient;
	spaceId: string;
	threadRootSignalId?: string;
	throughOccurredAtMs: number;
}): { rollback: Rollback } {
	const targetsKey = inboxQueryKeys.spaceUnreadTargets(
		input.organizationId,
		input.spaceId
	);
	const currentTargets =
		input.queryClient.getQueryData<SpaceInboxUnreadTargetsResponse>(targetsKey);
	if (!currentTargets) {
		return { rollback: () => undefined };
	}

	const removedTargets = currentTargets.targets.filter((target) =>
		matchesReadThrough(target, input)
	);
	if (removedTargets.length === 0) {
		return { rollback: () => undefined };
	}

	const rollbacks: Rollback[] = [];
	const remainingTargets = currentTargets.targets.filter(
		(target) => !matchesReadThrough(target, input)
	);
	const nextTargets: SpaceInboxUnreadTargetsResponse = {
		...currentTargets,
		targets: remainingTargets,
		totalUnreadCount: Math.max(
			0,
			currentTargets.totalUnreadCount - removedTargets.length
		),
	};
	setOptimisticQueryData({
		next: nextTargets,
		previous: currentTargets,
		queryClient: input.queryClient,
		queryKey: targetsKey,
		rollbacks,
	});

	updateSpaceSummary({
		...input,
		remainingTargets,
		removedCount: removedTargets.length,
		rollbacks,
		targetsAreComplete: !currentTargets.hasMoreTargets,
	});
	updateInboxSummary({
		organizationId: input.organizationId,
		queryClient: input.queryClient,
		removedCount: removedTargets.length,
		rollbacks,
	});
	if (input.destination === "center-agent") {
		updateCenterAgentSummary({
			organizationId: input.organizationId,
			queryClient: input.queryClient,
			removedCount: removedTargets.length,
			rollbacks,
		});
	}

	return {
		rollback: () => {
			for (const rollback of rollbacks.toReversed()) {
				rollback();
			}
		},
	};
}

function matchesReadThrough(
	target: SpaceInboxUnreadTarget,
	input: {
		threadRootSignalId?: string;
		throughOccurredAtMs: number;
	}
): boolean {
	const targetThreadRootSignalId = target.threadRootSignalId ?? undefined;
	return (
		targetThreadRootSignalId === input.threadRootSignalId &&
		target.occurredAtMs <= input.throughOccurredAtMs
	);
}

function updateSpaceSummary(input: {
	destination: SpaceInboxUnreadDestination;
	organizationId: string;
	queryClient: QueryClient;
	remainingTargets: readonly SpaceInboxUnreadTarget[];
	removedCount: number;
	rollbacks: Rollback[];
	spaceId: string;
	targetsAreComplete: boolean;
}) {
	const queryKey = inboxQueryKeys.spaceSummary(input.organizationId);
	const previous =
		input.queryClient.getQueryData<SpaceInboxSummaryResponse>(queryKey);
	if (!previous) {
		return;
	}
	const currentSpace = previous.spaces.find(
		(space) => space.spaceId === input.spaceId
	);
	if (!currentSpace) {
		return;
	}
	const unreadCount = Math.max(
		0,
		currentSpace.unreadCount - input.removedCount
	);
	const latestRemainingOccurredAtMs = input.targetsAreComplete
		? input.remainingTargets.reduce(
				(latest, target) => Math.max(latest, target.occurredAtMs),
				0
			)
		: currentSpace.latestUnreadOccurredAtMs;
	const spaces = previous.spaces
		.flatMap((space) => {
			if (space.spaceId !== input.spaceId) {
				return [space];
			}
			if (unreadCount === 0) {
				return [];
			}
			return [
				{
					...space,
					latestUnreadOccurredAtMs:
						latestRemainingOccurredAtMs || space.latestUnreadOccurredAtMs,
					unreadCount,
				},
			];
		})
		.toSorted(
			(left, right) =>
				right.latestUnreadOccurredAtMs - left.latestUnreadOccurredAtMs ||
				left.spaceId.localeCompare(right.spaceId)
		);
	const next: SpaceInboxSummaryResponse = {
		...previous,
		...(input.destination === "ordinary-space" &&
		previous.ordinarySpaceUnreadCount !== undefined
			? {
					ordinarySpaceUnreadCount: Math.max(
						0,
						previous.ordinarySpaceUnreadCount - input.removedCount
					),
				}
			: {}),
		spaces,
	};
	setOptimisticQueryData({
		next,
		previous,
		queryClient: input.queryClient,
		queryKey,
		rollbacks: input.rollbacks,
	});
}

function updateInboxSummary(input: {
	organizationId: string;
	queryClient: QueryClient;
	removedCount: number;
	rollbacks: Rollback[];
}) {
	const queryKey = inboxQueryKeys.summary(input.organizationId);
	const previous =
		input.queryClient.getQueryData<InboxSummaryResponse>(queryKey);
	if (!previous) {
		return;
	}
	setOptimisticQueryData({
		next: {
			...previous,
			totalUnreadCount: Math.max(
				0,
				previous.totalUnreadCount - input.removedCount
			),
		},
		previous,
		queryClient: input.queryClient,
		queryKey,
		rollbacks: input.rollbacks,
	});
}

function updateCenterAgentSummary(input: {
	organizationId: string;
	queryClient: QueryClient;
	removedCount: number;
	rollbacks: Rollback[];
}) {
	const queryKey = inboxQueryKeys.centerAgentSummary(input.organizationId);
	const previous =
		input.queryClient.getQueryData<CenterAgentInboxSummaryResponse>(queryKey);
	if (!previous) {
		return;
	}
	setOptimisticQueryData({
		next: {
			...previous,
			unreadCount: Math.max(0, previous.unreadCount - input.removedCount),
		},
		previous,
		queryClient: input.queryClient,
		queryKey,
		rollbacks: input.rollbacks,
	});
}

function setOptimisticQueryData<T>(input: {
	next: T;
	previous: T;
	queryClient: QueryClient;
	queryKey: QueryKey;
	rollbacks: Rollback[];
}) {
	const optimistic =
		input.queryClient.setQueryData<T>(input.queryKey, input.next) ?? input.next;
	input.rollbacks.push(() => {
		if (input.queryClient.getQueryData(input.queryKey) === optimistic) {
			input.queryClient.setQueryData(input.queryKey, input.previous);
		}
	});
}
