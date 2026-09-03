import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { describe, expect, it } from "vitest";
import {
	buildSpaceMemberDirectoryEntryByProfileId,
	resolveAgentProfileOwnerEntry,
} from "./space-collaboration-profile";

describe("resolveAgentProfileOwnerEntry", () => {
	it("reuses the matching Human identity and avatar for an Agent owner", () => {
		const agentProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const humanProfileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
		const avatarUrl = "https://images.example.test/felix.png";
		const entriesByProfileId = buildSpaceMemberDirectoryEntryByProfileId(
			createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						ownerUserId: "user_felix",
						profileId: agentProfileId,
					}),
				],
				humans: [
					{
						...createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: humanProfileId,
							profileName: "Felix",
						}),
						avatarUrl,
					},
				],
			})
		);
		const agentEntry = entriesByProfileId.get(agentProfileId);

		expect(agentEntry).toBeDefined();
		if (!agentEntry) {
			throw new Error("Expected the Agent entry in the test directory.");
		}
		const ownerEntry = resolveAgentProfileOwnerEntry({
			agentEntry,
			entriesByProfileId,
		});

		expect(ownerEntry?.profileId).toBe(humanProfileId);
		expect(ownerEntry?.avatarUrl).toBe(avatarUrl);
	});

	it("does not borrow an unrelated Human avatar", () => {
		const agentProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const entriesByProfileId = buildSpaceMemberDirectoryEntryByProfileId(
			createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						ownerUserId: "user_felix",
						profileId: agentProfileId,
					}),
				],
				humans: [
					createSpaceMemberHumanSnapshot({
						ownerUserId: "user_mira",
						profileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
					}),
				],
			})
		);
		const agentEntry = entriesByProfileId.get(agentProfileId);
		if (!agentEntry) {
			throw new Error("Expected the Agent entry in the test directory.");
		}

		expect(
			resolveAgentProfileOwnerEntry({
				agentEntry,
				entriesByProfileId,
			})
		).toBeNull();
	});
});
