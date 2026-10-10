"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { spaceInboxSummaryQueryOptions } from "#/query/organizations/inbox";
import {
	accountSpaceActiveWakeSummaryQueryOptions,
	useAccountSpaceActiveWakeSummaryDisplay,
} from "#/query/spaces/account-spaces";
import type { SpaceUnreadById } from "./account-space-sections";

export function useAccountSpaceIndicators(input: {
	enabled: boolean;
	organizationId: string;
	profileId: string;
}) {
	const unreadBySpaceId = useSpaceInboxUnreadById({
		enabled: input.enabled,
		organizationId: input.organizationId,
	});
	const activeWakeSummaryQuery = useQuery(
		accountSpaceActiveWakeSummaryQueryOptions({
			enabled: input.enabled && input.profileId.trim().length > 0,
			profileId: input.profileId,
		})
	);
	const activeWakeDisplay = useAccountSpaceActiveWakeSummaryDisplay({
		data: activeWakeSummaryQuery.data,
		isError: activeWakeSummaryQuery.isError,
	});
	const usableActiveWakeSummaryItems = activeWakeDisplay.items;
	const activeWakeSpaceIds = useMemo(
		() => new Set(usableActiveWakeSummaryItems.map((item) => item.spaceId)),
		[usableActiveWakeSummaryItems]
	);
	const activeWakeSummaryBySpaceId = useMemo(
		() =>
			new Map(usableActiveWakeSummaryItems.map((item) => [item.spaceId, item])),
		[usableActiveWakeSummaryItems]
	);

	return {
		isPending: input.enabled && activeWakeSummaryQuery.isPending,
		isError: activeWakeSummaryQuery.isError,
		isPaused: activeWakeSummaryQuery.fetchStatus === "paused",
		activityAvailable: activeWakeDisplay.available,
		activeWakeSpaceIds,
		activeWakeSummaryBySpaceId,
		unreadBySpaceId,
	};
}

export function useSpaceInboxUnreadById(input: {
	enabled: boolean;
	organizationId: string;
}): SpaceUnreadById {
	const unreadSummaryQuery = useQuery(
		spaceInboxSummaryQueryOptions({
			enabled: input.enabled && input.organizationId.trim().length > 0,
			organizationId: input.organizationId,
		})
	);
	const unreadBySpaceId: SpaceUnreadById = useMemo(
		() =>
			new Map(
				(unreadSummaryQuery.data?.spaces ?? []).map((item) => [
					item.spaceId,
					{
						latestUnreadOccurredAtMs: item.latestUnreadOccurredAtMs,
						unreadCount: item.unreadCount,
						messageUnreadCount: item.messageUnreadCount,
					},
				])
			),
		[unreadSummaryQuery.data?.spaces]
	);
	return unreadBySpaceId;
}
