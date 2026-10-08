import type {
	AuthProfileView,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { organizationDirectoryQueryFilters } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import {
	type AgentAvatarInvalidationScope,
	directoryContainsProfile,
	publishAgentAvatarInvalidation,
} from "./agent-avatar-invalidation";

// Apply only the successful Auth-owned save. Previews never mutate saved identity.
export async function applySavedAgentAvatarProfile(
	queryClient: QueryClient,
	profile: AuthProfileView,
	scope?: AgentAvatarInvalidationScope
): Promise<void> {
	const directories = organizationDirectoryQueryFilters();
	const organizationIds = new Set(
		queryClient
			.getQueryCache()
			.findAll(directories)
			.flatMap((query) =>
				directoryContainsProfile(query.state.data, profile.openMeldProfileId) &&
				typeof query.queryKey[1] === "string"
					? [query.queryKey[1]]
					: []
			)
	);
	if (scope) {
		organizationIds.add(scope.organizationId);
	}
	const profiles = { queryKey: startQueryKeys.allProfiles };
	const accountProfiles = { queryKey: startQueryKeys.allAccountProfiles };
	await Promise.all([
		queryClient.cancelQueries(directories),
		queryClient.cancelQueries(profiles),
		queryClient.cancelQueries(accountProfiles),
	]);
	queryClient.setQueriesData<OrganizationDirectoryResponse>(
		{
			...directories,
			predicate: (query) =>
				directories.predicate(query) && query.queryKey[2] === "directory",
		},
		(directory) =>
			directory
				? {
						...directory,
						agentProfiles: patchAvatar(directory.agentProfiles, profile),
					}
				: directory
	);
	queryClient.setQueriesData<OrganizationProfileDirectoryResponse>(
		{
			...directories,
			predicate: (query) =>
				directories.predicate(query) &&
				query.queryKey[2] === "profile-directory",
		},
		(directory) =>
			directory
				? {
						...directory,
						agentProfiles: patchAvatar(directory.agentProfiles, profile),
					}
				: directory
	);
	for (const queryKey of [
		startQueryKeys.allProfiles,
		startQueryKeys.allAccountProfiles,
	]) {
		queryClient.setQueriesData<readonly AuthProfileView[]>(
			{ queryKey },
			(entries) =>
				entries?.map((entry) =>
					entry.openMeldProfileId === profile.openMeldProfileId
						? {
								...entry,
								avatarStyle: profile.avatarStyle,
								avatarOptions: profile.avatarOptions,
								updatedAt: profile.updatedAt,
							}
						: entry
				)
		);
	}
	if (scope) {
		for (const organizationId of organizationIds) {
			publishAgentAvatarInvalidation({
				type: "agent.avatar.changed",
				ownerAccountId: scope.ownerAccountId,
				organizationId,
				profileId: profile.openMeldProfileId,
			});
		}
	}
	await Promise.all([
		queryClient.invalidateQueries(directories),
		queryClient.invalidateQueries(profiles),
		queryClient.invalidateQueries(accountProfiles),
	]);
}

function patchAvatar<T extends { profileId: string }>(
	entries: T[],
	profile: AuthProfileView
): T[] {
	return entries.map((entry) =>
		entry.profileId === profile.openMeldProfileId
			? {
					...entry,
					avatarStyle: profile.avatarStyle,
					avatarOptions: profile.avatarOptions,
					updatedAt: profile.updatedAt,
				}
			: entry
	);
}
