"use client";
import {
	hasVisibleActiveWakeProgress,
	mergeWakeProgressItems,
} from "@openmeld/space";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { AccountSpaceSections } from "#/lib/spaces/account-spaces";
import {
	filterSpaceWakeProgressItems,
	readSpaceWakeProgressSummaryItems,
	spaceActiveWakeProgressSummaryQueryOptions,
	spaceWakeProgressPresentationQueryOptions,
} from "#/query/spaces/active-wake-progress";
import {
	buildSpaceActiveWakeSummary,
	type SpaceSidebarActiveWakeSummary,
} from "./space-active-wake-presentation";
import { useSpaceWakeProgressVisibleProjection } from "./space-wake-progress-visible-projection";
import { useAccountSpaceIndicators } from "./use-account-space-indicators";
export function useSpaceListIndicators(input: {
	currentProfileId: string;
	currentSpaceId: string;
	organizationId: string;
	sections?: AccountSpaceSections;
	spaceIds?: readonly string[];
}) {
	const {
		isPending: isAccountSummaryPending,
		activityAvailable: isAccountSummaryAvailable,
		activeWakeSummaryBySpaceId: ambientActiveWakeSummaryBySpaceId,
		unreadBySpaceId,
	} = useAccountSpaceIndicators({
		enabled: !!input.currentProfileId,
		organizationId: input.organizationId,
		profileId: input.currentProfileId,
	});
	const otherActiveSpaceIds = [
		...new Set(
			[
				...(input.sections?.pinnedItems ?? []),
				...(input.sections?.spaceItems ?? []),
			]
				.flatMap((space) =>
					space.organizationId === input.organizationId &&
					space.spaceId !== input.currentSpaceId &&
					ambientActiveWakeSummaryBySpaceId.has(space.spaceId)
						? [space.spaceId]
						: []
				)
				.concat(
					(input.spaceIds ?? []).filter(
						(spaceId) =>
							spaceId !== input.currentSpaceId &&
							ambientActiveWakeSummaryBySpaceId.has(spaceId)
					)
				)
		),
	];
	const otherActiveSpaceQueries = useQueries({
		queries: otherActiveSpaceIds.map((spaceId) => ({
			...spaceActiveWakeProgressSummaryQueryOptions({
				enabled: input.currentProfileId.trim().length > 0,
				openMeldProfileId: input.currentProfileId,
				spaceId,
			}),
			// Closed Spaces follow the existing ambient refresh cadence. The open
			// Space continues to use its live, invalidation-driven projection.
			refetchInterval: 15_000,
			refetchIntervalInBackground: false,
		})),
	});
	// Cache-only observers keep completion evidence alive for exactly the same
	// closed Spaces whose summaries the sidebar is currently presenting.
	const otherPresentations = useQueries({
		queries: otherActiveSpaceIds.map((spaceId) =>
			spaceWakeProgressPresentationQueryOptions({
				spaceId,
				openMeldProfileId: input.currentProfileId,
			})
		),
	});
	const currentSpaceWakeProgressPresentationQuery = useQuery(
		spaceWakeProgressPresentationQueryOptions({
			openMeldProfileId: input.currentProfileId,
			spaceId: input.currentSpaceId,
		})
	);
	const currentSpaceActiveWakeProgressSummaryQuery = useQuery(
		spaceActiveWakeProgressSummaryQueryOptions({
			enabled: false,
			openMeldProfileId: input.currentProfileId,
			spaceId: input.currentSpaceId,
		})
	);
	const currentSpaceWakeProgressVisibleProjection =
		useSpaceWakeProgressVisibleProjection();
	const activeWakeSummaryBySpaceId = new Map<
		string,
		SpaceSidebarActiveWakeSummary
	>(
		Array.from(ambientActiveWakeSummaryBySpaceId).filter(
			([spaceId]) => spaceId !== input.currentSpaceId
		)
	);
	const currentSpaceWakeProgressItems =
		currentSpaceWakeProgressVisibleProjection ??
		filterSpaceWakeProgressItems({
			presentation: currentSpaceWakeProgressPresentationQuery.data,
			items: mergeWakeProgressItems({
				currentItems: readSpaceWakeProgressSummaryItems({
					presentation: currentSpaceWakeProgressPresentationQuery.data,
					summary: currentSpaceActiveWakeProgressSummaryQuery.data,
				}),
				incomingItems: currentSpaceWakeProgressPresentationQuery.data.items,
			}),
		});
	otherActiveSpaceQueries.forEach((query, index) => {
		const spaceId = otherActiveSpaceIds[index];
		if (!(spaceId && query.isSuccess)) {
			return;
		}
		const presentation = otherPresentations[index]?.data;
		if (!presentation) {
			return;
		}
		const items = readSpaceWakeProgressSummaryItems({
			presentation,
			summary: query.data,
		});
		if (items.length === 0 && !query.data.pageInfo?.hasMore) {
			activeWakeSummaryBySpaceId.delete(spaceId);
			return;
		}
		activeWakeSummaryBySpaceId.set(spaceId, {
			...buildSpaceActiveWakeSummary({
				fallbackSummary: ambientActiveWakeSummaryBySpaceId.get(spaceId),
				items,
				spaceId,
			}),
			hasMore: query.data.pageInfo?.hasMore,
		});
	});
	if (
		input.currentSpaceId.trim().length > 0 &&
		hasVisibleActiveWakeProgress({
			items: currentSpaceWakeProgressItems,
		})
	) {
		activeWakeSummaryBySpaceId.set(
			input.currentSpaceId,
			buildSpaceActiveWakeSummary({
				fallbackSummary: ambientActiveWakeSummaryBySpaceId.get(
					input.currentSpaceId
				),
				items: currentSpaceWakeProgressItems,
				spaceId: input.currentSpaceId,
			})
		);
	}
	return {
		activeWakeSummaryBySpaceId,
		unreadBySpaceId,
		// Keep recovered Space evidence visible even while account discovery retries.
		isPending: isAccountSummaryPending && activeWakeSummaryBySpaceId.size === 0,
		activityUnavailable: !isAccountSummaryAvailable,
	};
}
