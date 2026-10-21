import { createDirectMessageApi } from "@openmeld/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { DISPLAY_REVISIT_GC_TIME_MS } from "#/query/query-config";

export const agentDirectMessageSessionQueryKeys = {
	root: ["agent-direct-message-sessions"] as const,
	all: (organizationId: string) =>
		[...agentDirectMessageSessionQueryKeys.root, organizationId] as const,
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

// Bounds one read to 2,000 Sessions per Profile; `nextCursor` stays set when
// more exist so a caller can say the list is incomplete.
const MAX_SESSION_PAGES = 20;

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
		queryFn: async ({ signal }) => {
			// Session selectors list every Session; read each page in order.
			const api = createAgentDirectMessageSessionApi(input.organizationId);
			const first = await api.listSessions({
				agentProfileId: input.agentProfileId,
				archived,
				limit: 100,
				signal,
			});
			const sessions = [...first.sessions];
			let cursor = first.nextCursor;
			for (let page = 1; cursor && page < MAX_SESSION_PAGES; page += 1) {
				const next = await api.listSessions({
					agentProfileId: input.agentProfileId,
					archived,
					cursor,
					limit: 100,
					signal,
				});
				sessions.push(...next.sessions);
				cursor = next.nextCursor;
			}
			return { ...first, sessions, nextCursor: cursor };
		},
		staleTime: 30_000,
		gcTime: DISPLAY_REVISIT_GC_TIME_MS,
	});
}
