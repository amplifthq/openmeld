import {
	MEMBER_AGENT_SYNC_ROUTE,
	type SyncMemberAgentsResponse,
	syncMemberAgentsResponseSchema,
} from "@openmeld/schemas";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

/**
 * Asks Core (`syncMemberAgents`) to finish the member's MemberAgents in this
 * Organization and assign bound Profiles. It creates no MemberAgent: only
 * setup and "add" request one. `addableHarnessKinds` lists the detected
 * Harnesses the member can add. Pages work without it: a failure leaves the
 * existing MemberAgents as they are.
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
		return { changed: didMemberAgentSyncChange(response), response };
	} catch (error) {
		console.warn("MemberAgent sync is unavailable.", error);
		return { changed: false, response: null };
	}
}

/**
 * True when a sync changed what the MemberAgent reads show: it created or
 * finished an Agent, or put an unassigned Profile under its Agent.
 */
export function didMemberAgentSyncChange(
	response: SyncMemberAgentsResponse
): boolean {
	return (
		response.assignedProfileIds.length > 0 ||
		response.results.some(
			(result) => result.outcome === "created" || result.outcome === "completed"
		)
	);
}

/**
 * True while a sync left a MemberAgent half set up: its Binding or owner
 * Direct Message did not finish (for example the computer's report was
 * between auth checks). Another sync finishes it; Core retries only the
 * missing steps.
 */
export function hasPendingMemberAgentSetup(
	response: SyncMemberAgentsResponse | null | undefined
): boolean {
	return (
		response?.results.some(
			(result) =>
				(result.outcome === "created" || result.outcome === "completed") &&
				(result.binding !== "succeeded" || result.directMessage !== "succeeded")
		) ?? false
	);
}
