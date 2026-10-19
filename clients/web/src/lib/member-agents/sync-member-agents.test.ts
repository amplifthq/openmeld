import {
	type SyncMemberAgentsResponse,
	syncMemberAgentsResponseSchema,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { hasPendingMemberAgentSetup } from "./sync-member-agents";

function response(
	result: Partial<SyncMemberAgentsResponse["results"][number]>
): SyncMemberAgentsResponse {
	return syncMemberAgentsResponseSchema.parse({
		ok: true,
		organizationId: "org-test",
		results: [
			{
				binding: "succeeded",
				defaultProfileId: "agt-codex",
				directMessage: "succeeded",
				directMessageSpaceId: "space-dm",
				harnessKind: "codex",
				memberAgentId: "ma-codex",
				outcome: "created",
				reasonCodes: [],
				...result,
			},
		],
	});
}

describe("hasPendingMemberAgentSetup", () => {
	it("keeps syncing while a new Agent's Binding or Direct Message is unfinished", () => {
		expect(
			hasPendingMemberAgentSetup(
				response({
					binding: "rejected",
					reasonCodes: ["agent_profile_binding.agent_controller_report_stale"],
				})
			)
		).toBe(true);
		expect(
			hasPendingMemberAgentSetup(
				response({ directMessage: "failed", directMessageSpaceId: null })
			)
		).toBe(true);
	});

	it("stops once every Agent is set up or nothing changed", () => {
		expect(hasPendingMemberAgentSetup(response({}))).toBe(false);
		expect(
			hasPendingMemberAgentSetup(
				response({
					binding: "not_attempted",
					directMessage: "not_attempted",
					outcome: "unchanged",
				})
			)
		).toBe(false);
		expect(hasPendingMemberAgentSetup(null)).toBe(false);
	});
});
