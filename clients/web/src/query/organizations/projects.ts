import type { ListProjectsResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	listCurrentProjects,
	type ProjectFailure,
} from "#/lib/organizations/projects";
import { baseQueryOptions } from "#/query/query-config";

export const projectQueryKeys = {
	all: ["projects"] as const,
	organization: (organizationId: string) =>
		[...projectQueryKeys.all, organizationId] as const,
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
