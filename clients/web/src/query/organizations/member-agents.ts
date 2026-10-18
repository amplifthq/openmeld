import { createMemberAgentsApi } from "@openmeld/api-client";
import {
	getMemberAgentPresenceResponseSchema,
	MEMBER_AGENT_PRESENCE_ROUTE,
} from "@openmeld/schemas";
import { queryOptions } from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { DISPLAY_REVISIT_GC_TIME_MS } from "#/query/query-config";

export const memberAgentQueryKeys = {
	all: (organizationId: string) => ["member-agents", organizationId] as const,
	presence: (organizationId: string) =>
		[...memberAgentQueryKeys.all(organizationId), "presence"] as const,
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
		queryFn: () =>
			createMemberAgentsApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: input.organizationId,
				})
			).list(),
		staleTime: 30_000,
		gcTime: DISPLAY_REVISIT_GC_TIME_MS,
	});
}

/**
 * Core's derived MemberAgent presence (state with debounce, workload) for
 * the signed-in member. It is never stored; reread it while a page is open.
 */
export function memberAgentPresenceQueryOptions(input: {
	organizationId: string;
	enabled: boolean;
}) {
	return queryOptions({
		queryKey: memberAgentQueryKeys.presence(input.organizationId),
		enabled: input.enabled,
		queryFn: ({ signal }) =>
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			}).requestJson({
				url: MEMBER_AGENT_PRESENCE_ROUTE,
				method: "GET",
				operation: "member_agents.presence",
				signal,
				schema: getMemberAgentPresenceResponseSchema,
				invalidMessage: "OpenMeld couldn't read your Agents' state.",
			}),
		staleTime: 15_000,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
		gcTime: DISPLAY_REVISIT_GC_TIME_MS,
	});
}
