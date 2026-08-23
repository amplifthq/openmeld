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
const ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_CLOCK_SKEW_MS = 5000;
const observedSummaryGeneratedAtByResponse = new WeakMap<
	AccountSpaceActiveWakeSummaryResponse,
	number
>();

type AccountSpaceActiveWakeSummaryObservation = {
	data: AccountSpaceActiveWakeSummaryResponse | undefined;
	isExpired: boolean;
	observedGeneratedAtMs: number | null;
	receivedAtMs: number;
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
	return selectObservedAccountSpaceActiveWakeSummaryItems({
		data: input.data,
		isError: input.isError,
		isExpired: false,
		nowMs: input.nowMs,
		observedGeneratedAtMs,
	});
}

export function useUsableAccountSpaceActiveWakeSummaryItems(input: {
	data: AccountSpaceActiveWakeSummaryResponse | undefined;
	isError: boolean;
	receivedAtMs: number;
}): AccountSpaceActiveWakeSummaryResponse["items"] {
	const [observation, setObservation] = useState(() =>
		createAccountSpaceActiveWakeSummaryObservation(input)
	);
	if (observation.data !== input.data) {
		setObservation(createAccountSpaceActiveWakeSummaryObservation(input));
	} else if (observation.receivedAtMs !== input.receivedAtMs) {
		setObservation(
			updateAccountSpaceActiveWakeSummaryReceipt({
				observation,
				receivedAtMs: input.receivedAtMs,
			})
		);
	}
	useEffect(() => {
		if (
			observation.data === undefined ||
			observation.observedGeneratedAtMs === null
		) {
			return;
		}
		const committedObservedGeneratedAtMs =
			commitStableObservedSummaryGeneratedAtMs({
				data: observation.data,
				observedGeneratedAtMs: observation.observedGeneratedAtMs,
			});
		if (committedObservedGeneratedAtMs < observation.observedGeneratedAtMs) {
			setObservation((currentObservation) =>
				currentObservation === observation
					? {
							...currentObservation,
							observedGeneratedAtMs: committedObservedGeneratedAtMs,
						}
					: currentObservation
			);
			return;
		}
		if (observation.isExpired) {
			return;
		}
		const nowMs = Date.now();
		const remainingMs =
			observation.observedGeneratedAtMs +
			ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS -
			nowMs;
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
		nowMs: Date.now(),
		observedGeneratedAtMs: observation.observedGeneratedAtMs,
	});
}

function createAccountSpaceActiveWakeSummaryObservation(input: {
	data: AccountSpaceActiveWakeSummaryResponse | undefined;
	receivedAtMs: number;
}): AccountSpaceActiveWakeSummaryObservation {
	return {
		data: input.data,
		isExpired: false,
		observedGeneratedAtMs: input.data
			? resolveStableObservedSummaryGeneratedAtMs({
					data: input.data,
					nowMs: Date.now(),
					receivedAtMs: input.receivedAtMs,
				})
			: null,
		receivedAtMs: input.receivedAtMs,
	};
}

function updateAccountSpaceActiveWakeSummaryReceipt(input: {
	observation: AccountSpaceActiveWakeSummaryObservation;
	receivedAtMs: number;
}): AccountSpaceActiveWakeSummaryObservation {
	const nextObservedGeneratedAtMs = input.observation.data
		? resolveStableObservedSummaryGeneratedAtMs({
				data: input.observation.data,
				nowMs: Date.now(),
				receivedAtMs: input.receivedAtMs,
			})
		: null;
	return {
		...input.observation,
		observedGeneratedAtMs:
			input.observation.observedGeneratedAtMs === null ||
			nextObservedGeneratedAtMs === null
				? nextObservedGeneratedAtMs
				: Math.min(
						input.observation.observedGeneratedAtMs,
						nextObservedGeneratedAtMs
					),
		receivedAtMs: input.receivedAtMs,
	};
}

function resolveStableObservedSummaryGeneratedAtMs(input: {
	data: AccountSpaceActiveWakeSummaryResponse;
	nowMs: number;
	receivedAtMs: number;
}): number | null {
	const nextObservedGeneratedAtMs = resolveObservedSummaryGeneratedAtMs({
		generatedAtMs: input.data.generatedAtMs,
		nowMs: input.nowMs,
		receivedAtMs: input.receivedAtMs,
	});
	if (nextObservedGeneratedAtMs === null) {
		return null;
	}

	// TanStack Query reuses an immutable response object when a cached query is
	// revisited. Render may read the earliest committed anchor, but only the
	// effect writes it so an abandoned render cannot affect visible lifetime.
	const currentObservedGeneratedAtMs = observedSummaryGeneratedAtByResponse.get(
		input.data
	);
	return currentObservedGeneratedAtMs === undefined
		? nextObservedGeneratedAtMs
		: Math.min(currentObservedGeneratedAtMs, nextObservedGeneratedAtMs);
}

function commitStableObservedSummaryGeneratedAtMs(input: {
	data: AccountSpaceActiveWakeSummaryResponse;
	observedGeneratedAtMs: number;
}): number {
	const currentObservedGeneratedAtMs = observedSummaryGeneratedAtByResponse.get(
		input.data
	);
	const observedGeneratedAtMs =
		currentObservedGeneratedAtMs === undefined
			? input.observedGeneratedAtMs
			: Math.min(currentObservedGeneratedAtMs, input.observedGeneratedAtMs);
	observedSummaryGeneratedAtByResponse.set(input.data, observedGeneratedAtMs);
	return observedGeneratedAtMs;
}

function selectObservedAccountSpaceActiveWakeSummaryItems(input: {
	data: AccountSpaceActiveWakeSummaryResponse | undefined;
	isError: boolean;
	isExpired: boolean;
	nowMs: number;
	observedGeneratedAtMs: number | null;
}): AccountSpaceActiveWakeSummaryResponse["items"] {
	if (
		input.isError ||
		!input.data ||
		input.isExpired ||
		input.observedGeneratedAtMs === null ||
		input.observedGeneratedAtMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS <
			input.nowMs
	) {
		return [];
	}
	return input.data.items;
}

function resolveObservedSummaryGeneratedAtMs(input: {
	generatedAtMs: number;
	nowMs: number;
	receivedAtMs: number;
}): number | null {
	if (
		input.receivedAtMs <= 0 ||
		input.receivedAtMs >
			input.nowMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_CLOCK_SKEW_MS ||
		input.generatedAtMs >
			input.nowMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_CLOCK_SKEW_MS ||
		input.generatedAtMs >
			input.receivedAtMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_CLOCK_SKEW_MS
	) {
		return null;
	}

	// Core owns the summary timestamp. The receipt timestamp can originate during
	// Web SSR, so both clocks may be slightly ahead of the browser. Clamp both to
	// the browser's current time so accepted skew never extends the shared age.
	return Math.min(input.generatedAtMs, input.receivedAtMs, input.nowMs);
}
