import { createDirectMessageApi } from "@openmeld/api-client";
import {
	type ListMemberAgentDirectMessageSessionsResponse,
	listMemberAgentDirectMessageSessionsResponseSchema,
	MAX_MEMBER_AGENT_DIRECT_MESSAGE_SESSIONS_PAGE,
	MEMBER_AGENT_DIRECT_MESSAGE_SESSIONS_ROUTE,
} from "@openmeld/schemas";
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
	/** Every Session with the signed-in member's own MemberAgents. */
	memberAgents: (organizationId: string) =>
		[
			...agentDirectMessageSessionQueryKeys.all(organizationId),
			"member-agents",
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

/**
 * The signed-in Human's Sessions with every Profile of their own
 * MemberAgents, active and archived, in one read. Surfaces that need every
 * Session's title or archive state use this instead of one list per Profile.
 */
export function memberAgentDirectMessageSessionsQueryOptions(input: {
	organizationId: string;
	enabled: boolean;
}) {
	return queryOptions({
		queryKey: agentDirectMessageSessionQueryKeys.memberAgents(
			input.organizationId
		),
		enabled: input.enabled,
		queryFn: async ({ signal }) => {
			const api = createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			});
			const readPage = (cursor: string | null) => {
				const query = new URLSearchParams({
					limit: String(MAX_MEMBER_AGENT_DIRECT_MESSAGE_SESSIONS_PAGE),
				});
				if (cursor) {
					query.set("cursor", cursor);
				}
				return api.requestJson({
					url: `${MEMBER_AGENT_DIRECT_MESSAGE_SESSIONS_ROUTE}?${query.toString()}`,
					method: "GET",
					operation: "member_agents.direct_message_sessions.list",
					signal,
					schema: listMemberAgentDirectMessageSessionsResponseSchema,
					invalidMessage: "Invalid chat list.",
				});
			};
			const first: ListMemberAgentDirectMessageSessionsResponse =
				await readPage(null);
			const sessions = [...first.sessions];
			let cursor = first.nextCursor;
			for (let page = 1; cursor && page < MAX_SESSION_PAGES; page += 1) {
				const next = await readPage(cursor);
				sessions.push(...next.sessions);
				cursor = next.nextCursor;
			}
			return { ...first, sessions, nextCursor: cursor };
		},
		staleTime: 30_000,
		gcTime: DISPLAY_REVISIT_GC_TIME_MS,
	});
}
