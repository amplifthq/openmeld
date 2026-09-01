import type {
	OrganizationAgentRuntimeOverviewResponse,
	OrganizationComputersResponse,
	OrganizationDirectoryResponse,
	OrganizationMemberOpenMeldServiceStatusesResponse,
	OrganizationProfileDirectoryResponse,
	OrganizationSpaceDirectoryWithMemberCountsResponse,
} from "@openmeld/schemas/types";
import { type QueryKey, queryOptions } from "@tanstack/react-query";
import {
	type OrganizationComputersFailure,
	readCurrentOrganizationComputers,
} from "#/lib/organizations/organization-computers";
import {
	type OrganizationDirectoryFailure,
	readCurrentOrganizationAgentRuntimeOverview,
	readCurrentOrganizationDirectory,
	readCurrentOrganizationProfileDirectory,
} from "#/lib/organizations/organization-directory";
import {
	type OrganizationMemberOpenMeldServiceStatusesFailure,
	readCurrentOrganizationMemberOpenMeldServiceStatuses,
} from "#/lib/organizations/organization-member-openmeld-service-statuses";
import {
	listCurrentOrganizationSpaces,
	type OrganizationSpacesFailure,
} from "#/lib/organizations/organization-spaces";
import type { OrganizationRole } from "#/lib/organizations/organization-types";
import {
	baseQueryOptions,
	PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
	ROUTE_REVISIT_GC_TIME_MS,
} from "#/query/query-config";

export const organizationQueryKeys = {
	all: ["organizations"] as const,
	organization: (organizationId: string) =>
		[...organizationQueryKeys.all, organizationId] as const,
	directory: (organizationId: string) =>
		[
			...organizationQueryKeys.organization(organizationId),
			"directory",
		] as const,
	profileDirectory: (organizationId: string) =>
		[
			...organizationQueryKeys.organization(organizationId),
			"profile-directory",
		] as const,
	agentRuntimeOverview: (organizationId: string) =>
		[
			...organizationQueryKeys.organization(organizationId),
			"agent-runtime-overview",
		] as const,
	computers: (organizationId: string) =>
		[
			...organizationQueryKeys.organization(organizationId),
			"computers",
		] as const,
	invitations: (organizationId: string) =>
		[
			...organizationQueryKeys.organization(organizationId),
			"invitations",
		] as const,
	joinLink: (organizationId: string) =>
		[
			...organizationQueryKeys.organization(organizationId),
			"join-link",
		] as const,
	memberOpenMeldServiceStatuses: (organizationId: string) =>
		[
			...organizationQueryKeys.organization(organizationId),
			"member-openmeld-service-statuses",
		] as const,
	role: (organizationId: string, userId: string) =>
		[
			...organizationQueryKeys.organization(organizationId),
			"role",
			userId,
		] as const,
	spaces: (organizationId: string) =>
		[...organizationQueryKeys.organization(organizationId), "spaces"] as const,
};

export function organizationDirectoryQueryFilters(input?: {
	organizationId?: string;
}) {
	return {
		predicate: (query: { queryKey: QueryKey }) =>
			query.queryKey.length === 3 &&
			query.queryKey[0] === organizationQueryKeys.all[0] &&
			(input?.organizationId === undefined ||
				query.queryKey[1] === input.organizationId) &&
			(query.queryKey[2] === "directory" ||
				query.queryKey[2] === "profile-directory"),
		queryKey: organizationQueryKeys.all,
	};
}

export function organizationComputersQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		OrganizationComputersResponse,
		OrganizationComputersFailure
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await readCurrentOrganizationComputers({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationQueryKeys.computers(input.organizationId),
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function organizationMemberOpenMeldServiceStatusesQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		OrganizationMemberOpenMeldServiceStatusesResponse,
		OrganizationMemberOpenMeldServiceStatusesFailure
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await readCurrentOrganizationMemberOpenMeldServiceStatuses({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationQueryKeys.memberOpenMeldServiceStatuses(
			input.organizationId
		),
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

type OrganizationDirectoryAgentProfile =
	OrganizationDirectoryResponse["agentProfiles"][number];
type OrganizationDirectoryHumanProfile = NonNullable<
	OrganizationDirectoryResponse["members"][number]["humanProfile"]
>;

export type OrganizationSpaceProfileCandidates = {
	agentProfiles: readonly Pick<
		OrganizationDirectoryAgentProfile,
		| "isCenterAgent"
		| "ownerName"
		| "profileHandle"
		| "profileId"
		| "profileName"
		| "status"
	>[];
	members: readonly {
		humanProfile: Pick<
			OrganizationDirectoryHumanProfile,
			"profileHandle" | "profileId" | "profileName" | "status"
		> | null;
		memberName: string;
	}[];
	organizationId: string;
};

export function organizationDirectoryQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		OrganizationDirectoryResponse,
		OrganizationDirectoryFailure
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async () =>
			await readCurrentOrganizationDirectory({
				organizationId: input.organizationId,
			}),
		queryKey: organizationQueryKeys.directory(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function organizationProfileDirectoryQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		OrganizationProfileDirectoryResponse,
		OrganizationDirectoryFailure
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await readCurrentOrganizationProfileDirectory({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationQueryKeys.profileDirectory(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function organizationAgentRuntimeOverviewQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		OrganizationAgentRuntimeOverviewResponse,
		OrganizationDirectoryFailure
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await readCurrentOrganizationAgentRuntimeOverview({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationQueryKeys.agentRuntimeOverview(input.organizationId),
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function organizationMemberRoleQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
	userId: string;
}) {
	return queryOptions<OrganizationRole, OrganizationDirectoryFailure | Error>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ client }) => {
			const directory = await client.fetchQuery(
				organizationDirectoryQueryOptions({
					enabled: true,
					organizationId: input.organizationId,
				})
			);
			if (directory.organizationId !== input.organizationId) {
				throw new Error(
					"Organization directory resolved for a different organization."
				);
			}
			const role = directory.members.find(
				(member) => member.userId === input.userId
			)?.role;
			if (!role) {
				throw new Error(
					"The current account is missing from the organization directory."
				);
			}
			return role;
		},
		queryKey: organizationQueryKeys.role(input.organizationId, input.userId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 60_000,
	});
}

export function organizationSpaceProfileCandidatesQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		OrganizationDirectoryResponse,
		OrganizationDirectoryFailure,
		OrganizationSpaceProfileCandidates
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async () =>
			await readCurrentOrganizationDirectory({
				organizationId: input.organizationId,
			}),
		queryKey: organizationQueryKeys.directory(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		select: (directory) => ({
			agentProfiles: directory.agentProfiles
				.filter(
					(profile) =>
						profile.managedRole !== "center_agent" ||
						profile.organizationId === directory.organizationId
				)
				.map((profile) => ({
					isCenterAgent: profile.isCenterAgent,
					ownerName: profile.ownerName,
					profileHandle: profile.profileHandle,
					profileId: profile.profileId,
					profileName: profile.profileName,
					status: profile.status,
				})),
			members: directory.members.map((member) => ({
				humanProfile: member.humanProfile
					? {
							profileHandle: member.humanProfile.profileHandle,
							profileId: member.humanProfile.profileId,
							profileName: member.humanProfile.profileName,
							status: member.humanProfile.status,
						}
					: null,
				memberName: member.user.name,
			})),
			organizationId: directory.organizationId,
		}),
		staleTime: 10_000,
	});
}

export function organizationSpacesQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		OrganizationSpaceDirectoryWithMemberCountsResponse,
		OrganizationSpacesFailure
	>({
		enabled: input.enabled,
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
		queryFn: async () =>
			await listCurrentOrganizationSpaces({
				organizationId: input.organizationId,
			}),
		queryKey: organizationQueryKeys.spaces(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}
