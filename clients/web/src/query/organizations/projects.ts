import type {
	ListProjectsResponse,
	ReadProjectIssueRoutingResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	listCurrentProjects,
	type ProjectFailure,
	readCurrentProjectCommonAgents,
	readCurrentProjectIssueRouting,
	readCurrentProjectRepositorySettings,
} from "#/lib/organizations/projects";
import { baseQueryOptions } from "#/query/query-config";

export const projectQueryKeys = {
	all: ["projects"] as const,
	organization: (organizationId: string) =>
		[...projectQueryKeys.all, organizationId] as const,
	issueRouting: (organizationId: string, projectId: string) =>
		[
			...projectQueryKeys.organization(organizationId),
			"issue-routing",
			projectId,
		] as const,
	repositories: (organizationId: string, projectId: string) =>
		[
			...projectQueryKeys.organization(organizationId),
			"repositories",
			projectId,
		] as const,
	commonAgents: (organizationId: string, projectId: string) =>
		[
			...projectQueryKeys.organization(organizationId),
			"common-agents",
			projectId,
		] as const,
};

export function projectsQueryOptions(input: {
	enabled?: boolean;
	organizationId: string;
}) {
	return queryOptions<ListProjectsResponse, ProjectFailure>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await listCurrentProjects({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: projectQueryKeys.organization(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function projectIssueRoutingQueryOptions(input: {
	organizationId: string;
	projectId: string;
}) {
	return queryOptions<ReadProjectIssueRoutingResponse, ProjectFailure>({
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await readCurrentProjectIssueRouting({ ...input, signal }),
		queryKey: projectQueryKeys.issueRouting(
			input.organizationId,
			input.projectId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function projectRepositorySettingsQueryOptions(input: {
	organizationId: string;
	projectId: string;
}) {
	return queryOptions({
		queryKey: projectQueryKeys.repositories(
			input.organizationId,
			input.projectId
		),
		queryFn: async ({ signal }) =>
			await readCurrentProjectRepositorySettings({ ...input, signal }),
		staleTime: 10_000,
	});
}

export function projectCommonAgentsQueryOptions(input: {
	organizationId: string;
	projectId: string;
}) {
	return queryOptions({
		queryKey: projectQueryKeys.commonAgents(
			input.organizationId,
			input.projectId
		),
		queryFn: async ({ signal }) =>
			await readCurrentProjectCommonAgents({ ...input, signal }),
		staleTime: 10_000,
	});
}
