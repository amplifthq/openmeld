import type { ListCenterAgentSessionsResponse } from "@openmeld/schemas";
import type { OrganizationSpaceDirectoryWithMemberCountsResponse } from "@openmeld/schemas/types";
import type {
	InfiniteData,
	Query,
	QueryClient,
	QueryKey,
} from "@tanstack/react-query";
import type { AccountSpaceSections } from "#/lib/spaces/account-spaces";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { removeAccountSpaceFromSections } from "./account-space-sections";

export type SpaceListCacheSnapshot = {
	spaceId: string;
	centerAgentSessions?: readonly [
		QueryKey,
		InfiniteData<ListCenterAgentSessionsResponse> | undefined,
	][];
	stopKeepingRemoved: () => void;
	accountSpaces: readonly [QueryKey, AccountSpaceSections | undefined][];
	organizationSpaces:
		| OrganizationSpaceDirectoryWithMemberCountsResponse
		| undefined;
};

const accountListFilters = {
	queryKey: accountSpaceQueryKeys.all,
	predicate: (query: Query) =>
		query.queryKey.length === 4 &&
		(query.queryKey[3] === "account" || query.queryKey[3] === "profile"),
};

export async function optimisticallyRemoveSpaceFromListCaches(input: {
	organizationId: string | null;
	queryClient: QueryClient;
	spaceId: string;
}): Promise<SpaceListCacheSnapshot> {
	return await optimisticallyUpdateSpaceListCaches(input);
}

export async function optimisticallyDeleteSpaceInListCaches(input: {
	organizationId: string | null;
	queryClient: QueryClient;
	spaceId: string;
}): Promise<SpaceListCacheSnapshot> {
	return await optimisticallyUpdateSpaceListCaches({
		...input,
		deletedAt: new Date().toISOString(),
	});
}

async function optimisticallyUpdateSpaceListCaches(input: {
	organizationId: string | null;
	queryClient: QueryClient;
	spaceId: string;
	deletedAt?: string;
}): Promise<SpaceListCacheSnapshot> {
	const organizationSpacesKey = input.organizationId
		? organizationQueryKeys.spaces(input.organizationId)
		: null;
	const centerFilters = {
		queryKey: ["center-agent", input.organizationId],
		predicate: (query: Query) => query.queryKey[3] === "sessions",
	};
	await Promise.all([
		input.queryClient.cancelQueries(centerFilters),
		input.queryClient.cancelQueries(accountListFilters),
		organizationSpacesKey
			? input.queryClient.cancelQueries({ queryKey: organizationSpacesKey })
			: Promise.resolve(),
	]);
	const snapshot: SpaceListCacheSnapshot = {
		spaceId: input.spaceId,
		centerAgentSessions:
			input.queryClient.getQueriesData<
				InfiniteData<ListCenterAgentSessionsResponse>
			>(centerFilters),
		stopKeepingRemoved: (): void => undefined,
		accountSpaces: input.queryClient.getQueriesData<AccountSpaceSections>({
			...accountListFilters,
		}),
		organizationSpaces: organizationSpacesKey
			? input.queryClient.getQueryData(organizationSpacesKey)
			: undefined,
	} satisfies SpaceListCacheSnapshot;

	const keepRemoved = () => {
		input.queryClient.setQueriesData<
			InfiniteData<ListCenterAgentSessionsResponse>
		>(centerFilters, (current) =>
			current?.pages.some((page) =>
				page.sessions.some((session) => session.spaceId === input.spaceId)
			)
				? {
						...current,
						pages: current.pages.map((page) => ({
							...page,
							sessions: page.sessions.filter(
								(session) => session.spaceId !== input.spaceId
							),
						})),
					}
				: current
		);
		input.queryClient.setQueriesData<AccountSpaceSections>(
			accountListFilters,
			(current) =>
				current &&
				[...current.pinnedItems, ...current.spaceItems].some(
					(item) => item.spaceId === input.spaceId
				)
					? applySpaceListIntent(current, input)
					: current
		);
		if (organizationSpacesKey) {
			input.queryClient.setQueryData<OrganizationSpaceDirectoryWithMemberCountsResponse>(
				organizationSpacesKey,
				(current) =>
					current?.spaces.some((space) => space.spaceId === input.spaceId)
						? {
								...current,
								spaces: current.spaces.filter(
									(space) => space.spaceId !== input.spaceId
								),
							}
						: current
			);
		}
	};
	keepRemoved();
	// Polling, focus refreshes and a newly mounted Browse page can return the
	// not-yet-deleted Space. Keep this presentation intent until the write settles.
	snapshot.stopKeepingRemoved = input.queryClient
		.getQueryCache()
		.subscribe((event) => {
			if (
				event.type === "updated" &&
				event.action.type === "success" &&
				!event.action.manual
			) {
				const key = event.query.queryKey;
				if (
					key[0] === accountSpaceQueryKeys.all[0] &&
					key[1] === accountSpaceQueryKeys.all[1] &&
					accountListFilters.predicate(event.query)
				) {
					if (
						!snapshot.accountSpaces.some(
							([savedKey]) => JSON.stringify(savedKey) === JSON.stringify(key)
						)
					) {
						snapshot.accountSpaces = [
							...snapshot.accountSpaces,
							[key, input.queryClient.getQueryData<AccountSpaceSections>(key)],
						];
					}
				} else if (
					organizationSpacesKey &&
					JSON.stringify(key) === JSON.stringify(organizationSpacesKey)
				) {
					snapshot.organizationSpaces ??= input.queryClient.getQueryData(
						organizationSpacesKey
					);
				} else if (
					key[0] === "center-agent" &&
					key[1] === input.organizationId &&
					centerFilters.predicate(event.query)
				) {
					// Use the same pending removal across the specialized session list.
				} else {
					return;
				}
				keepRemoved();
			}
		});
	return snapshot;
}

export function restoreSpaceListCaches(
	queryClient: QueryClient,
	organizationId: string | null,
	snapshot: SpaceListCacheSnapshot | undefined
): void {
	if (!snapshot) {
		return;
	}
	snapshot.stopKeepingRemoved();
	for (const [key, before] of snapshot.centerAgentSessions ?? []) {
		if (!before) {
			continue;
		}
		queryClient.setQueryData<InfiniteData<ListCenterAgentSessionsResponse>>(
			key,
			(current) =>
				current
					? {
							...current,
							pages: current.pages.map((page, index) => ({
								...page,
								sessions: restoreDeletedItem(
									page.sessions,
									before.pages[index]?.sessions ?? [],
									snapshot.spaceId
								),
							})),
						}
					: before
		);
	}
	for (const [queryKey, spaces] of snapshot.accountSpaces) {
		if (!spaces) {
			continue;
		}
		queryClient.setQueryData<AccountSpaceSections>(queryKey, (current) =>
			current
				? {
						...current,
						pinnedItems: restoreDeletedItem(
							current.pinnedItems,
							spaces.pinnedItems,
							snapshot.spaceId
						),
						spaceItems: restoreDeletedItem(
							current.spaceItems,
							spaces.spaceItems,
							snapshot.spaceId
						),
					}
				: spaces
		);
	}
	if (organizationId) {
		queryClient.setQueryData<OrganizationSpaceDirectoryWithMemberCountsResponse>(
			organizationQueryKeys.spaces(organizationId),
			(current) =>
				current && snapshot.organizationSpaces
					? {
							...current,
							spaces: restoreDeletedItem(
								current.spaces,
								snapshot.organizationSpaces.spaces,
								snapshot.spaceId
							),
						}
					: (current ?? snapshot.organizationSpaces)
		);
	}
}

function restoreDeletedItem<T extends { spaceId: string }>(
	current: readonly T[],
	before: readonly T[],
	spaceId: string
): T[] {
	const index = before.findIndex((item) => item.spaceId === spaceId);
	const item = before[index];
	if (!item) {
		return [...current];
	}
	if (current.some((entry) => entry.spaceId === spaceId)) {
		return current.map((entry) => (entry.spaceId === spaceId ? item : entry));
	}
	const restored = [...current];
	restored.splice(Math.min(index, restored.length), 0, item);
	return restored;
}

function updateItems(
	items: AccountSpaceSections["spaceItems"],
	input: { spaceId: string; deletedAt?: string }
): AccountSpaceSections["spaceItems"] {
	return input.deletedAt
		? items.map((item) =>
				item.spaceId === input.spaceId
					? { ...item, deletedAt: input.deletedAt }
					: item
			)
		: items.filter((item) => item.spaceId !== input.spaceId);
}

function applySpaceListIntent(
	current: AccountSpaceSections,
	input: { spaceId: string; deletedAt?: string }
): AccountSpaceSections {
	if (!input.deletedAt) {
		return removeAccountSpaceFromSections(current, input.spaceId);
	}
	return {
		...current,
		pinnedItems: updateItems(current.pinnedItems, input),
		spaceItems: updateItems(current.spaceItems, input),
	};
}
