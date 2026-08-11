import type { GetCenterAgentMemberResearchStatusResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	getCurrentCenterAgentMemberResearchStatus,
	type OrganizationDocumentFailure,
} from "#/lib/organizations/organization-documents";
import { baseQueryOptions } from "#/query/query-config";

export const centerAgentMemberResearchQueryKeys = {
	all: ["center-agent-member-research"] as const,
	status: (organizationId: string) =>
		[...centerAgentMemberResearchQueryKeys.all, organizationId] as const,
};

export function centerAgentMemberResearchStatusQueryOptions(input: {
	enabled?: boolean;
	organizationId: string;
}) {
	return queryOptions<
		GetCenterAgentMemberResearchStatusResponse,
		OrganizationDocumentFailure
	>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await getCurrentCenterAgentMemberResearchStatus({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: centerAgentMemberResearchQueryKeys.status(input.organizationId),
		refetchInterval: (query) => {
			const status = query.state.data?.latestBatch?.status;
			return status === "queued" || status === "running" ? 2000 : false;
		},
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 1000,
	});
}
