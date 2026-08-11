import { ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS } from "@openmeld/schemas";
import type { AccountSpaceActiveWakeSummaryResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import { getAccountSpaceActiveWakeSummary } from "#/lib/spaces/account-space-active-wake";
import {
	type AccountSpaceSections,
	listAccountSpaceItems,
} from "#/lib/spaces/account-spaces";
import { baseQueryOptions } from "#/query/query-config";

const ACCOUNT_SPACE_ACTIVE_WAKE_POLL_INTERVAL_MS = 15_000;

export const accountSpaceQueryKeys = {
	all: ["spaces", "account-spaces"] as const,
	activeWakeSummary: (profileId: string) =>
		["spaces", "account-spaces", profileId, "active-wake-summary"] as const,
	items: (profileId: string, scope: "account" | "profile") =>
		["spaces", "account-spaces", profileId, scope] as const,
} as const;

export function accountSpaceItemsQueryOptions(input: {
	enabled: boolean;
	profileId: string;
	scope?: "account" | "profile";
}) {
	const scope = input.scope ?? "account";
	return queryOptions<AccountSpaceSections, Error>({
		queryKey: accountSpaceQueryKeys.items(input.profileId, scope),
		queryFn: async () =>
			await listAccountSpaceItems({
				profileId: input.profileId,
				scope,
			}),
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		staleTime: 30 * 1000,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}

export function accountSpaceActiveWakeSummaryQueryOptions(input: {
	enabled: boolean;
	profileId: string;
}) {
	return queryOptions<AccountSpaceActiveWakeSummaryResponse, Error>({
		queryKey: accountSpaceQueryKeys.activeWakeSummary(input.profileId),
		queryFn: async () =>
			await getAccountSpaceActiveWakeSummary({
				data: { profileId: input.profileId },
			}),
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		refetchInterval: ACCOUNT_SPACE_ACTIVE_WAKE_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		staleTime: 10_000,
	});
}

export function selectUsableAccountSpaceActiveWakeSummaryItems(input: {
	data: AccountSpaceActiveWakeSummaryResponse | undefined;
	isError: boolean;
	nowMs: number;
}): AccountSpaceActiveWakeSummaryResponse["items"] {
	if (
		input.isError ||
		!input.data ||
		input.data.generatedAtMs > input.nowMs ||
		input.data.generatedAtMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS <
			input.nowMs
	) {
		return [];
	}
	return input.data.items;
}

export function useUsableAccountSpaceActiveWakeSummaryItems(input: {
	data: AccountSpaceActiveWakeSummaryResponse | undefined;
	isError: boolean;
}): AccountSpaceActiveWakeSummaryResponse["items"] {
	const [, rerenderAtExpiry] = useReducer((value: number) => value + 1, 0);
	const generatedAtMs = input.data?.generatedAtMs;
	useEffect(() => {
		if (input.isError || generatedAtMs === undefined) {
			return;
		}
		const remainingMs =
			generatedAtMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS - Date.now();
		if (remainingMs <= 0) {
			return;
		}
		const timeout = window.setTimeout(rerenderAtExpiry, remainingMs + 1);
		return () => window.clearTimeout(timeout);
	}, [generatedAtMs, input.isError]);

	return selectUsableAccountSpaceActiveWakeSummaryItems({
		data: input.data,
		isError: input.isError,
		nowMs: Date.now(),
	});
}
