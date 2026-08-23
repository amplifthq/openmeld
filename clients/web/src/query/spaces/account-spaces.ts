import { ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS } from "@openmeld/schemas";
import type { AccountSpaceActiveWakeSummaryResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getAccountSpaceActiveWakeSummary } from "#/lib/spaces/account-space-active-wake";
import {
	type AccountSpaceSections,
	listAccountSpaceItems,
} from "#/lib/spaces/account-spaces";
import { baseQueryOptions } from "#/query/query-config";

const ACCOUNT_SPACE_ACTIVE_WAKE_POLL_INTERVAL_MS = 15_000;

type AccountSpaceActiveWakePresentationSnapshot = {
	browserRequestStartedAtMonotonicMs: number | null;
	summary: AccountSpaceActiveWakeSummaryResponse;
};

type AccountSpaceActiveWakeSummaryObservation = {
	data: AccountSpaceActiveWakePresentationSnapshot | undefined;
	isExpired: boolean;
};

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
	return queryOptions<AccountSpaceActiveWakePresentationSnapshot, Error>({
		queryKey: accountSpaceQueryKeys.activeWakeSummary(input.profileId),
		queryFn: async () => {
			const browserRequestStartedAtMonotonicMs = readBrowserMonotonicNowMs();
			const summary = await getAccountSpaceActiveWakeSummary({
				data: { profileId: input.profileId },
			});
			return { browserRequestStartedAtMonotonicMs, summary };
		},
		enabled: input.enabled && typeof window !== "undefined",
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		refetchInterval: ACCOUNT_SPACE_ACTIVE_WAKE_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnMount: "always",
		refetchOnWindowFocus: "always",
		staleTime: 10_000,
	});
}

export function selectUsableAccountSpaceActiveWakeSummaryItems(input: {
	data: AccountSpaceActiveWakePresentationSnapshot | undefined;
	isError: boolean;
	nowMonotonicMs: number | null;
}): AccountSpaceActiveWakeSummaryResponse["items"] {
	return selectObservedAccountSpaceActiveWakeSummaryItems({
		data: input.data,
		isError: input.isError,
		isExpired: false,
		nowMonotonicMs: input.nowMonotonicMs,
	});
}

export function useUsableAccountSpaceActiveWakeSummaryItems(input: {
	data: AccountSpaceActiveWakePresentationSnapshot | undefined;
	isError: boolean;
}): AccountSpaceActiveWakeSummaryResponse["items"] {
	const [observation, setObservation] = useState(() =>
		createAccountSpaceActiveWakeSummaryObservation(input)
	);
	if (observation.data !== input.data) {
		setObservation(createAccountSpaceActiveWakeSummaryObservation(input));
	}
	useEffect(() => {
		const requestStartedAtMs =
			observation.data?.browserRequestStartedAtMonotonicMs;
		if (requestStartedAtMs === undefined || requestStartedAtMs === null) {
			return;
		}
		const nowMonotonicMs = readBrowserMonotonicNowMs();
		if (
			nowMonotonicMs === null ||
			requestStartedAtMs < 0 ||
			requestStartedAtMs > nowMonotonicMs
		) {
			setObservation((currentObservation) =>
				currentObservation === observation
					? { ...currentObservation, isExpired: true }
					: currentObservation
			);
			return;
		}
		if (observation.isExpired) {
			return;
		}
		const remainingMs =
			requestStartedAtMs +
			ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS -
			nowMonotonicMs;
		const timeout = window.setTimeout(
			() =>
				setObservation((currentObservation) =>
					currentObservation === observation
						? { ...currentObservation, isExpired: true }
						: currentObservation
				),
			Math.max(remainingMs, 0) + 1
		);
		return () => window.clearTimeout(timeout);
	}, [observation]);

	return selectObservedAccountSpaceActiveWakeSummaryItems({
		data: observation.data,
		isError: input.isError,
		isExpired: observation.isExpired,
		nowMonotonicMs: readBrowserMonotonicNowMs(),
	});
}

function createAccountSpaceActiveWakeSummaryObservation(input: {
	data: AccountSpaceActiveWakePresentationSnapshot | undefined;
}): AccountSpaceActiveWakeSummaryObservation {
	return {
		data: input.data,
		isExpired: false,
	};
}

function selectObservedAccountSpaceActiveWakeSummaryItems(input: {
	data: AccountSpaceActiveWakePresentationSnapshot | undefined;
	isError: boolean;
	isExpired: boolean;
	nowMonotonicMs: number | null;
}): AccountSpaceActiveWakeSummaryResponse["items"] {
	const requestStartedAtMs =
		input.data?.browserRequestStartedAtMonotonicMs ?? null;
	if (
		input.isError ||
		!input.data ||
		input.isExpired ||
		input.data.summary.generatedAtMs <= 0 ||
		requestStartedAtMs === null ||
		input.nowMonotonicMs === null ||
		requestStartedAtMs < 0 ||
		requestStartedAtMs > input.nowMonotonicMs ||
		requestStartedAtMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS <
			input.nowMonotonicMs
	) {
		return [];
	}
	return input.data.summary.items;
}

function readBrowserMonotonicNowMs(): number | null {
	return typeof window === "undefined" ? null : window.performance.now();
}
