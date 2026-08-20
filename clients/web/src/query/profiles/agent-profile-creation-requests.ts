import type {
	GetAgentProfileCreationApprovalPreferenceResponse,
	ListAgentProfileCreationRequestsResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	type AgentProfileCreationRequestsFailure,
	getAgentProfileCreationApprovalPreference,
	listAgentProfileCreationRequests,
} from "#/lib/profiles/agent-profile-creation-requests";
import {
	baseQueryOptions,
	ROUTE_REVISIT_GC_TIME_MS,
} from "#/query/query-config";

export const agentProfileCreationRequestQueryKeys = {
	all: ["agent-profile-creation-requests"] as const,
	byOrganization: (organizationId: string) =>
		[...agentProfileCreationRequestQueryKeys.all, organizationId] as const,
	preference: (organizationId: string) =>
		[
			...agentProfileCreationRequestQueryKeys.byOrganization(organizationId),
			"preference",
		] as const,
} as const;

export function agentProfileCreationRequestsQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		ListAgentProfileCreationRequestsResponse,
		AgentProfileCreationRequestsFailure
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await listAgentProfileCreationRequests({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: agentProfileCreationRequestQueryKeys.byOrganization(
			input.organizationId
		),
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 5000,
	});
}

export function agentProfileCreationApprovalPreferenceQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		GetAgentProfileCreationApprovalPreferenceResponse,
		AgentProfileCreationRequestsFailure
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async () =>
			await getAgentProfileCreationApprovalPreference({
				organizationId: input.organizationId,
			}),
		queryKey: agentProfileCreationRequestQueryKeys.preference(
			input.organizationId
		),
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}
