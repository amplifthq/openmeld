import {
	ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS,
	sanitizeSignalTextPreview,
} from "@openmeld/schemas";
import type {
	AccountSpaceActiveWakeSummaryResponse,
	SignalEnvelope,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	applyAcceptedAccountSpaceMessage,
	preserveOptimisticAccountSpacePinUpdates,
} from "#/components/spaces/account-space-sections";
import { withLocalAccountRuntimeFixtures } from "#/lib/dev/space-runtime-fixtures";
import { getAccountSpaceActiveWakeSummary } from "#/lib/spaces/account-space-active-wake";
import {
	type AccountSpaceSections,
	listAccountSpaceItems,
} from "#/lib/spaces/account-spaces";
import { baseQueryOptions } from "#/query/query-config";
import { spaceActiveWakeProgressSummaryQueryOptions } from "./active-wake-progress";

const ACCOUNT_SPACE_ACTIVE_WAKE_POLL_INTERVAL_MS = 15_000;
// Newly invited members have no live connection to that Space yet. Refresh
// the shared directory every five seconds while the app is in the foreground.
export const ACCOUNT_SPACE_ITEMS_POLL_INTERVAL_MS = 5000;

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

// The accepted Space signal is already authoritative while its index catches up.
export function updateAccountSpaceAcceptedMessage(
	client: QueryClient,
	profileId: string,
	signal: SignalEnvelope
): void {
	if (signal.type !== "signal.text") {
		return;
	}
	client.setQueriesData<AccountSpaceSections>(
		{
			queryKey: [...accountSpaceQueryKeys.all, profileId],
			predicate: (query) =>
				query.queryKey[3] === "account" || query.queryKey[3] === "profile",
		},
		(current) =>
			current
				? applyAcceptedAccountSpaceMessage(current, signal.spaceId, {
						signalId: signal.id,
						profileId: signal.profile.profileId,
						timestamp: signal.ts,
						text: (
							sanitizeSignalTextPreview(signal.data.text) ?? "Message"
						).slice(0, 240),
					})
				: current
	);
}

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
		refetchInterval: ACCOUNT_SPACE_ITEMS_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		staleTime: 30 * 1000,
		refetchOnMount: true,
		refetchOnWindowFocus: "always",
		structuralSharing: preserveOptimisticAccountSpacePinUpdates,
	});
}

export function accountSpaceActiveWakeSummaryQueryOptions(input: {
	enabled: boolean;
	profileId: string;
}) {
	return queryOptions<AccountSpaceActiveWakePresentationSnapshot, Error>({
		queryKey: accountSpaceQueryKeys.activeWakeSummary(input.profileId),
		queryFn: async ({ client }) => {
			const browserRequestStartedAtMonotonicMs = readBrowserMonotonicNowMs();
			const summary = await getAccountSpaceActiveWakeSummary({
				data: { profileId: input.profileId },
			});
			if (import.meta.env.DEV) {
				const local = await withLocalAccountRuntimeFixtures(
					summary,
					input.profileId,
					(spaceId) =>
						client.fetchQuery(
							spaceActiveWakeProgressSummaryQueryOptions({
								enabled: true,
								spaceId,
								openMeldProfileId: input.profileId,
							})
						)
				);
				// Use the normal detail reader so account refreshes retain the same
				// presentation lifetime and outcome evidence as opened Spaces.
				return { browserRequestStartedAtMonotonicMs, summary: local.summary };
			}
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
