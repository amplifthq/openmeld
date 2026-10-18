import { listMemberAgentsResponseSchema } from "@openmeld/schemas";
import { queryOptions } from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { DISPLAY_REVISIT_GC_TIME_MS } from "#/query/query-config";

export const memberAgentQueryKeys = {
	all: (organizationId: string) => ["member-agents", organizationId] as const,
	sync: (organizationId: string) =>
		[...memberAgentQueryKeys.all(organizationId), "sync"] as const,
};

/** The signed-in member's MemberAgents and unassigned Profiles (owner-only). */
export function memberAgentsQueryOptions(input: {
	organizationId: string;
	enabled: boolean;
}) {
	return queryOptions({
		queryKey: memberAgentQueryKeys.all(input.organizationId),
		enabled: input.enabled,
		queryFn: ({ signal }) =>
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			}).requestJson({
				url: "/v1/member-agents",
				method: "GET",
				operation: "member_agents.list",
				signal,
				schema: listMemberAgentsResponseSchema,
				invalidMessage: "OpenMeld couldn't load your Agents.",
			}),
		staleTime: 30_000,
		gcTime: DISPLAY_REVISIT_GC_TIME_MS,
	});
}
