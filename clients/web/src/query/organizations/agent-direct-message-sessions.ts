import { createDirectMessageApi } from "@openmeld/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { DISPLAY_REVISIT_GC_TIME_MS } from "#/query/query-config";

export const agentDirectMessageSessionQueryKeys = {
	all: (organizationId: string) =>
		["agent-direct-message-sessions", organizationId] as const,
	list: (input: {
		organizationId: string;
		agentProfileId: string;
		archived: boolean;
	}) =>
		[
			...agentDirectMessageSessionQueryKeys.all(input.organizationId),
			input.agentProfileId,
			input.archived ? "archived" : "active",
		] as const,
};

export function createAgentDirectMessageSessionApi(organizationId: string) {
	return createDirectMessageApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
}

/** One agent Profile's Direct Message Sessions with the signed-in Human. */
export function agentDirectMessageSessionsQueryOptions(input: {
	organizationId: string;
	agentProfileId: string;
	archived?: boolean;
	enabled: boolean;
}) {
	const archived = input.archived === true;
	return queryOptions({
		queryKey: agentDirectMessageSessionQueryKeys.list({
			organizationId: input.organizationId,
			agentProfileId: input.agentProfileId,
			archived,
		}),
		enabled: input.enabled,
		queryFn: ({ signal }) =>
			createAgentDirectMessageSessionApi(input.organizationId).listSessions({
				agentProfileId: input.agentProfileId,
				archived,
				limit: 100,
				signal,
			}),
		staleTime: 30_000,
		gcTime: DISPLAY_REVISIT_GC_TIME_MS,
	});
}
