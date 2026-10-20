import {
	type SyncMemberAgentsResponse,
	syncMemberAgentsResponseSchema,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
	didMemberAgentSyncChange,
	hasPendingMemberAgentSetup,
} from "./sync-member-agents";

function response(
	result: Partial<SyncMemberAgentsResponse["results"][number]>,
	assignedProfileIds: string[] = []
): SyncMemberAgentsResponse {
	return syncMemberAgentsResponseSchema.parse({
		ok: true,
		organizationId: "org-test",
		assignedProfileIds,
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

describe("didMemberAgentSyncChange", () => {
	const unchanged = {
		binding: "not_attempted",
		directMessage: "not_attempted",
		outcome: "unchanged",
	} as const;

	it("refreshes the Agent reads after an unassigned Profile joins its Agent", () => {
		expect(
			didMemberAgentSyncChange(response(unchanged, ["agt-second-cursor"]))
		).toBe(true);
	});

	it("refreshes after a created or finished Agent, not after no change", () => {
		expect(didMemberAgentSyncChange(response({}))).toBe(true);
		expect(didMemberAgentSyncChange(response(unchanged))).toBe(false);
	});
});
