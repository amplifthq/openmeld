import {
	MEMBER_AGENT_SYNC_ROUTE,
	type SyncMemberAgentsResponse,
	syncMemberAgentsResponseSchema,
} from "@openmeld/schemas";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

/**
 * Asks Core (`syncMemberAgents`) to create any MemberAgent the member's
 * connected computers report for this Organization; creation is lazy per
 * Organization. Pages work without it: a failure leaves the existing
 * MemberAgents as they are.
 */
export async function syncMemberAgents(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<{ changed: boolean; response: SyncMemberAgentsResponse | null }> {
	try {
		const response = await createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		}).requestJson({
			url: MEMBER_AGENT_SYNC_ROUTE,
			method: "POST",
			operation: "member_agents.sync",
			signal: input.signal,
			schema: syncMemberAgentsResponseSchema,
			invalidMessage: "OpenMeld couldn't refresh your Agents.",
		});
		return {
			changed: response.results.some(
				(result) =>
					result.outcome === "created" || result.outcome === "completed"
			),
			response,
		};
	} catch (error) {
		console.warn("MemberAgent sync is unavailable.", error);
		return { changed: false, response: null };
	}
}
