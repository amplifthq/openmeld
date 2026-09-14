import type { OrganizationSpaceDirectoryWithMemberCountsResponse } from "@openmeld/schemas/types";
import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import type { AccountSpaceSections } from "#/lib/spaces/account-spaces";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

export type SpaceDeleteCacheSnapshot = {
	spaceId: string;
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
}): Promise<SpaceDeleteCacheSnapshot> {
	const organizationSpacesKey = input.organizationId
		? organizationQueryKeys.spaces(input.organizationId)
		: null;
	await Promise.all([
		input.queryClient.cancelQueries(accountListFilters),
		organizationSpacesKey
			? input.queryClient.cancelQueries({ queryKey: organizationSpacesKey })
			: Promise.resolve(),
	]);
	const snapshot: SpaceDeleteCacheSnapshot = {
		spaceId: input.spaceId,
		stopKeepingRemoved: (): void => undefined,
		accountSpaces: input.queryClient.getQueriesData<AccountSpaceSections>({
			...accountListFilters,
		}),
		organizationSpaces: organizationSpacesKey
			? input.queryClient.getQueryData(organizationSpacesKey)
			: undefined,
	} satisfies SpaceDeleteCacheSnapshot;

	const keepRemoved = () => {
		input.queryClient.setQueriesData<AccountSpaceSections>(
			accountListFilters,
			(current) =>
				current &&
				[...current.pinnedItems, ...current.spaceItems].some(
					(item) => item.spaceId === input.spaceId
				)
					? {
							...current,
							pinnedItems: current.pinnedItems.filter(
								(item) => item.spaceId !== input.spaceId
							),
							spaceItems: current.spaceItems.filter(
								(item) => item.spaceId !== input.spaceId
							),
						}
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
	snapshot: SpaceDeleteCacheSnapshot | undefined
): void {
	if (!snapshot) {
		return;
	}
	snapshot.stopKeepingRemoved();
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
	if (current.some((item) => item.spaceId === spaceId)) {
		return [...current];
	}
	const index = before.findIndex((item) => item.spaceId === spaceId);
	const item = before[index];
	if (!item) {
		return [...current];
	}
	const restored = [...current];
	restored.splice(Math.min(index, restored.length), 0, item);
	return restored;
}
