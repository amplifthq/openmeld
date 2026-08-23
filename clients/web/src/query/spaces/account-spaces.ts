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
const ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_FUTURE_SKEW_MS = 5000;

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
	receivedAtMs: number;
}): AccountSpaceActiveWakeSummaryResponse["items"] {
	if (input.isError || !input.data) {
		return [];
	}
	const observedGeneratedAtMs = resolveObservedSummaryGeneratedAtMs({
		generatedAtMs: input.data.generatedAtMs,
		nowMs: input.nowMs,
		receivedAtMs: input.receivedAtMs,
	});
	if (
		observedGeneratedAtMs === null ||
		observedGeneratedAtMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS <
			input.nowMs
	) {
		return [];
	}
	return input.data.items;
}

export function useUsableAccountSpaceActiveWakeSummaryItems(input: {
	data: AccountSpaceActiveWakeSummaryResponse | undefined;
	isError: boolean;
	receivedAtMs: number;
}): AccountSpaceActiveWakeSummaryResponse["items"] {
	const [, rerenderAtExpiry] = useReducer((value: number) => value + 1, 0);
	const generatedAtMs = input.data?.generatedAtMs;
	useEffect(() => {
		if (input.isError || generatedAtMs === undefined) {
			return;
		}
		const nowMs = Date.now();
		const observedGeneratedAtMs = resolveObservedSummaryGeneratedAtMs({
			generatedAtMs,
			nowMs,
			receivedAtMs: input.receivedAtMs,
		});
		if (observedGeneratedAtMs === null) {
			return;
		}
		const remainingMs =
			observedGeneratedAtMs +
			ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS -
			nowMs;
		const timeout = window.setTimeout(
			rerenderAtExpiry,
			Math.max(remainingMs, 0) + 1
		);
		return () => window.clearTimeout(timeout);
	}, [generatedAtMs, input.isError, input.receivedAtMs]);

	return selectUsableAccountSpaceActiveWakeSummaryItems({
		data: input.data,
		isError: input.isError,
		nowMs: Date.now(),
		receivedAtMs: input.receivedAtMs,
	});
}

function resolveObservedSummaryGeneratedAtMs(input: {
	generatedAtMs: number;
	nowMs: number;
	receivedAtMs: number;
}): number | null {
	if (
		input.receivedAtMs <= 0 ||
		input.receivedAtMs > input.nowMs ||
		input.generatedAtMs >
			input.receivedAtMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_FUTURE_SKEW_MS
	) {
		return null;
	}

	// Core owns the summary timestamp. The local receipt time only bounds normal
	// cross-machine clock skew so the Web never extends the shared maximum age.
	return Math.min(input.generatedAtMs, input.receivedAtMs);
}
