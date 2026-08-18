import type { GetAgentProfileCreationDefaultsResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { getAgentProfileCreationDefaults } from "#/lib/profiles/agent-profile-creation-defaults";
import { baseQueryOptions } from "#/query/query-config";

export const agentProfileCreationDefaultsQueryKeys = {
	all: ["agent-profile", "creation-defaults"] as const,
	byController: (input: {
		agentControllerRef: string;
		organizationId: string;
	}) =>
		[
			...agentProfileCreationDefaultsQueryKeys.all,
			input.organizationId,
			input.agentControllerRef,
		] as const,
};

export function agentProfileCreationDefaultsQueryOptions(input: {
	agentControllerRef: string;
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<GetAgentProfileCreationDefaultsResponse>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async () => await getAgentProfileCreationDefaults(input),
		queryKey: agentProfileCreationDefaultsQueryKeys.byController(input),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}
