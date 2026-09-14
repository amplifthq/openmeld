import type { OrganizationSpaceDirectoryWithMemberCountsResponse } from "@openmeld/schemas/types";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { AccountSpaceSections } from "#/lib/spaces/account-spaces";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

export type SpaceDeleteCacheSnapshot = {
	accountSpaces: readonly [QueryKey, AccountSpaceSections | undefined][];
	organizationSpaces:
		| OrganizationSpaceDirectoryWithMemberCountsResponse
		| undefined;
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
		input.queryClient.cancelQueries({ queryKey: accountSpaceQueryKeys.all }),
		organizationSpacesKey
			? input.queryClient.cancelQueries({ queryKey: organizationSpacesKey })
			: Promise.resolve(),
	]);
	const snapshot = {
		accountSpaces: input.queryClient.getQueriesData<AccountSpaceSections>({
			queryKey: accountSpaceQueryKeys.all,
		}),
		organizationSpaces: organizationSpacesKey
			? input.queryClient.getQueryData(organizationSpacesKey)
			: undefined,
	} satisfies SpaceDeleteCacheSnapshot;

	input.queryClient.setQueriesData<AccountSpaceSections>(
		{ queryKey: accountSpaceQueryKeys.all },
		(current) =>
			current
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
				current
					? {
							...current,
							spaces: current.spaces.filter(
								(space) => space.spaceId !== input.spaceId
							),
						}
					: current
		);
	}
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
	for (const [queryKey, spaces] of snapshot.accountSpaces) {
		queryClient.setQueryData(queryKey, spaces);
	}
	if (organizationId) {
		queryClient.setQueryData(
			organizationQueryKeys.spaces(organizationId),
			snapshot.organizationSpaces
		);
	}
}
