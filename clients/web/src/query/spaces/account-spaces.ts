import { normalizeMessagePreview } from "@openmeld/protocol";
import {
	ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS,
	sanitizeSignalTextPreview,
} from "@openmeld/schemas";
import type {
	AccountSpaceActiveWakeSummaryResponse,
	OrganizationSpaceDirectoryWithMemberCountsResponse,
	PostSpaceMembersResponse,
	SignalEnvelope,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	applyAcceptedAccountSpaceMembership,
	applyAcceptedAccountSpaceMessage,
	reconcileAccountSpaceSections,
} from "#/components/spaces/account-space-sections";
import { withLocalAccountRuntimeFixtures } from "#/lib/dev/space-runtime-fixtures";
import { getAccountSpaceActiveWakeSummary } from "#/lib/spaces/account-space-active-wake";
import {
	type AccountSpaceItem,
	type AccountSpaceSections,
	createAcceptedAccountSpaceItem,
	listAccountSpaceItems,
} from "#/lib/spaces/account-spaces";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	baseQueryOptions,
	DISPLAY_REVISIT_GC_TIME_MS,
} from "#/query/query-config";
import { spaceActiveWakeProgressSummaryQueryOptions } from "./active-wake-progress";

const ACCOUNT_SPACE_ACTIVE_WAKE_POLL_INTERVAL_MS = 15_000;
// The account invalidation stream covers unopened Spaces and new memberships.
// Foreground polling repairs missed events without repeatedly scanning an idle
// account; focus and stream reconnect also revalidate immediately.
export const ACCOUNT_SPACE_ITEMS_POLL_INTERVAL_MS = 30_000;

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

export function updateAccountSpaceAcceptedMembership(
	client: QueryClient,
	profileId: string,
	item: AccountSpaceItem
): void {
	const filters = {
		queryKey: [...accountSpaceQueryKeys.all, profileId],
		predicate: (query: { queryKey: readonly unknown[] }) =>
			query.queryKey[3] === "account" || query.queryKey[3] === "profile",
	};
	client.setQueriesData<AccountSpaceSections>(filters, (current) =>
		applyAcceptedAccountSpaceMembership(
			current ?? { pinnedItems: [], spaceItems: [] },
			item
		)
	);
	if (!client.getQueryData(accountSpaceQueryKeys.items(profileId, "account"))) {
		client.setQueryData(
			accountSpaceQueryKeys.items(profileId, "account"),
			applyAcceptedAccountSpaceMembership(
				{ pinnedItems: [], spaceItems: [] },
				item
			)
		);
	}
}

export function acceptOrganizationSpaceMembership(
	client: QueryClient,
	input: {
		organizationId: string;
		spaceId: string;
		profileId: string;
		response: PostSpaceMembersResponse;
	}
): void {
	const key = organizationQueryKeys.spaces(input.organizationId);
	const directory =
		client.getQueryData<OrganizationSpaceDirectoryWithMemberCountsResponse>(
			key
		);
	const space = directory?.spaces.find(
		(item) => item.spaceId === input.spaceId
	);
	const member = input.response.items.find(
		(item) => item.profileId === input.profileId && item.status === "active"
	);
	if (space && member) {
		updateAccountSpaceAcceptedMembership(
			client,
			input.profileId,
			createAcceptedAccountSpaceItem({
				organizationId: input.organizationId,
				spaceId: input.spaceId,
				name: space.name,
				visibility: space.visibility,
				profileId: member.profileId,
				profileName: member.profileName,
				joinedAt: member.addedAt,
				createdAt: space.spaceCreatedAt,
				activeMemberCount:
					space.activeMemberCount === null
						? null
						: space.activeMemberCount +
							Number(input.response.addedMemberIds.includes(member.profileId)),
			})
		);
	}
	client.setQueryData<OrganizationSpaceDirectoryWithMemberCountsResponse>(
		key,
		(current) =>
			current
				? {
						...current,
						spaces: current.spaces.map((item) =>
							item.spaceId === input.spaceId
								? {
										...item,
										joined: true,
										lastJoinedAt: member?.addedAt ?? item.lastJoinedAt,
									}
								: item
						),
					}
				: current
	);
}

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
							sanitizeSignalTextPreview(
								normalizeMessagePreview(signal.data.text)
							) ?? "Message"
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
		gcTime: DISPLAY_REVISIT_GC_TIME_MS,
		retry: baseQueryOptions.retry,
		refetchInterval: ACCOUNT_SPACE_ITEMS_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		staleTime: 30 * 1000,
		refetchOnMount: true,
		refetchOnWindowFocus: "always",
		structuralSharing: reconcileAccountSpaceSections,
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
	return useAccountSpaceActiveWakeSummaryDisplay(input).items;
}

export function useAccountSpaceActiveWakeSummaryDisplay(input: {
	data: AccountSpaceActiveWakePresentationSnapshot | undefined;
	isError: boolean;
}): {
	available: boolean;
	items: AccountSpaceActiveWakeSummaryResponse["items"];
} {
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

	const selection = {
		data: observation.data,
		isError: input.isError,
		isExpired: observation.isExpired,
		nowMonotonicMs: readBrowserMonotonicNowMs(),
	};
	return {
		available: isAccountSpaceActiveWakeSummaryUsable(selection),
		items: selectObservedAccountSpaceActiveWakeSummaryItems(selection),
	};
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
	return isAccountSpaceActiveWakeSummaryUsable(input)
		? (input.data?.summary.items ?? [])
		: [];
}

function isAccountSpaceActiveWakeSummaryUsable(input: {
	data: AccountSpaceActiveWakePresentationSnapshot | undefined;
	isError: boolean;
	isExpired: boolean;
	nowMonotonicMs: number | null;
}): boolean {
	const requestStartedAtMs =
		input.data?.browserRequestStartedAtMonotonicMs ?? null;
	return !(
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
	);
}

function readBrowserMonotonicNowMs(): number | null {
	return typeof window === "undefined" ? null : window.performance.now();
}
