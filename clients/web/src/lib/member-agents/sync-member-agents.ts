import { z } from "zod/v4";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

// TODO(1c): replace this route constant and response schema with
// MEMBER_AGENT_SYNC_ROUTE and the sync response schema from
// packages/schemas/src/schemas/http/member-agent-sync.ts once package 1c
// merges. Until then this adapter is the only place that knows the contract.
const MEMBER_AGENT_SYNC_ROUTE = "/v1/organizations/current/member-agents/sync";
const memberAgentSyncResponseSchema = z.looseObject({});

/**
 * Asks Core to create any MemberAgent the member's connected computers report
 * for this Organization (lazy per Organization). Pages work without it: a
 * failure leaves the existing MemberAgents as they are.
 */
export async function syncMemberAgents(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<{ synced: boolean }> {
	try {
		await createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		}).requestJson({
			url: MEMBER_AGENT_SYNC_ROUTE,
			method: "POST",
			operation: "member_agents.sync",
			headers: { "content-type": "application/json" },
			body: "{}",
			signal: input.signal,
			schema: memberAgentSyncResponseSchema,
			invalidMessage: "OpenMeld couldn't refresh your Agents.",
		});
		return { synced: true };
	} catch (error) {
		console.warn("MemberAgent sync is unavailable.", error);
		return { synced: false };
	}
}
