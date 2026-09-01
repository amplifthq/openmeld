import type {
	AuthProfileView,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
	organizationDirectoryQueryFilters,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";

export type AgentProfileDeleteCacheSnapshot = {
	directories: readonly [
		QueryKey,
		(
			| OrganizationDirectoryResponse
			| OrganizationProfileDirectoryResponse
			| undefined
		),
	][];
	profiles: readonly [QueryKey, readonly AuthProfileView[] | undefined][];
};

export async function optimisticallyRemoveAgentProfileFromListCaches(input: {
	agentProfileId: string;
	queryClient: QueryClient;
	storageScope: string;
}): Promise<AgentProfileDeleteCacheSnapshot> {
	const profileQueryFilters = {
		queryKey: startQueryKeys.profilesForStorageScope(input.storageScope),
	};
	const directoryQueryFilters = organizationDirectoryQueryFilters();
	await Promise.all([
		input.queryClient.cancelQueries(profileQueryFilters),
		input.queryClient.cancelQueries(directoryQueryFilters),
	]);
	const snapshot = {
		directories: input.queryClient.getQueriesData<
			OrganizationDirectoryResponse | OrganizationProfileDirectoryResponse
		>(directoryQueryFilters),
		profiles:
			input.queryClient.getQueriesData<readonly AuthProfileView[]>(
				profileQueryFilters
			),
	} satisfies AgentProfileDeleteCacheSnapshot;

	input.queryClient.setQueriesData<readonly AuthProfileView[]>(
		profileQueryFilters,
		(profiles) => removeAgentProfileFromProfiles(profiles, input.agentProfileId)
	);
	input.queryClient.setQueriesData<OrganizationDirectoryResponse>(
		organizationDirectoryTypeQueryFilters("directory"),
		(directory) =>
			directory
				? {
						...directory,
						agentProfiles: directory.agentProfiles.filter(
							(profile) => profile.profileId !== input.agentProfileId
						),
					}
				: directory
	);
	input.queryClient.setQueriesData<OrganizationProfileDirectoryResponse>(
		organizationDirectoryTypeQueryFilters("profile-directory"),
		(directory) =>
			directory
				? {
						...directory,
						agentProfiles: directory.agentProfiles.filter(
							(profile) => profile.profileId !== input.agentProfileId
						),
					}
				: directory
	);

	return snapshot;
}

export function restoreAgentProfileListCaches(
	queryClient: QueryClient,
	snapshot: AgentProfileDeleteCacheSnapshot | undefined
): void {
	if (!snapshot) {
		return;
	}
	for (const [queryKey, profiles] of snapshot.profiles) {
		queryClient.setQueryData(queryKey, profiles);
	}
	for (const [queryKey, directory] of snapshot.directories) {
		queryClient.setQueryData(queryKey, directory);
	}
}

export async function invalidateAgentProfileListCaches(input: {
	queryClient: QueryClient;
	storageScope: string;
}): Promise<void> {
	await Promise.all([
		input.queryClient.invalidateQueries({
			queryKey: startQueryKeys.profilesForStorageScope(input.storageScope),
		}),
		input.queryClient.invalidateQueries(organizationDirectoryQueryFilters()),
	]);
}

function organizationDirectoryTypeQueryFilters(
	type: "directory" | "profile-directory"
) {
	return {
		predicate: (query: { queryKey: QueryKey }) =>
			query.queryKey.length === 3 &&
			query.queryKey[0] === organizationQueryKeys.all[0] &&
			query.queryKey[2] === type,
		queryKey: organizationQueryKeys.all,
	};
}

function removeAgentProfileFromProfiles(
	profiles: readonly AuthProfileView[] | undefined,
	agentProfileId: string
): readonly AuthProfileView[] | undefined {
	return profiles?.filter(
		(profile) => profile.openMeldProfileId !== agentProfileId
	);
}
