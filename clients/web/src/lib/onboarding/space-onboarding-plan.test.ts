import { describe, expect, it } from "vitest";
import {
	deriveSpaceOnboardingPlan,
	mapAccountProfiles,
	resolveSpaceMembershipFacts,
} from "./space-onboarding-plan";

function accountProfile(
	overrides: Partial<{
		openMeldProfileId: string;
		profileName: string;
		profileKind: "human" | "agent";
		status: string;
	}> = {}
) {
	return {
		openMeldProfileId: "h1",
		profileName: "Felix",
		profileKind: "human" as const,
		status: "active",
		...overrides,
	};
}

function member(
	overrides: Partial<{
		profileId: string;
		status: string;
		removedAt: string | null;
		ownerUserId: string | null;
	}> = {}
) {
	return {
		profileId: "x",
		status: "active",
		removedAt: null,
		ownerUserId: "owner-1",
		...overrides,
	};
}

describe("mapAccountProfiles", () => {
	it("maps schema fields and derives active from status", () => {
		expect(
			mapAccountProfiles([
				accountProfile(),
				accountProfile({
					openMeldProfileId: "a1",
					profileName: "Claude",
					profileKind: "agent",
					status: "disabled",
				}),
			])
		).toEqual([
			{ profileId: "h1", kind: "human", name: "Felix", active: true },
			{ profileId: "a1", kind: "agent", name: "Claude", active: false },
		]);
	});
});

describe("resolveSpaceMembershipFacts", () => {
	it("returns null without a snapshot", () => {
		expect(
			resolveSpaceMembershipFacts(null, {
				spaceId: "s",
				actingProfileId: "h1",
			})
		).toBeNull();
	});

	it("marks the acting human a member only when active and present", () => {
		const snapshot = { humans: [member({ profileId: "h1" })], agents: [] };

		expect(
			resolveSpaceMembershipFacts(snapshot, {
				spaceId: "s",
				actingProfileId: "h1",
			})
		).toEqual({
			spaceId: "s",
			actingProfileIsMember: true,
			memberAgentProfileIds: [],
		});

		expect(
			resolveSpaceMembershipFacts(snapshot, {
				spaceId: "s",
				actingProfileId: "someone-else",
			})?.actingProfileIsMember
		).toBe(false);
	});

	it("counts every active member agent regardless of account ownership", () => {
		const snapshot = {
			humans: [member({ profileId: "h1" })],
			agents: [
				member({ profileId: "a1", ownerUserId: null }),
				member({ profileId: "a2", ownerUserId: "owner-1" }),
				member({
					profileId: "a3",
					ownerUserId: "owner-1",
					status: "removed",
					removedAt: "2026-01-01T00:00:00.000Z",
				}),
			],
		};

		expect(
			resolveSpaceMembershipFacts(snapshot, {
				spaceId: "s",
				actingProfileId: "h1",
			})?.memberAgentProfileIds
		).toEqual(["a1", "a2"]);
	});

	it("recognizes an agent-acting profile that is an active member", () => {
		expect(
			resolveSpaceMembershipFacts(
				{
					humans: [member({ profileId: "h1" })],
					agents: [member({ profileId: "a1", ownerUserId: "owner-1" })],
				},
				{ spaceId: "s", actingProfileId: "a1" }
			)?.actingProfileIsMember
		).toBe(true);
	});
});

describe("deriveSpaceOnboardingPlan", () => {
	it("yields connect available + bring_agents blocked for a joined zero-agent user", () => {
		const plan = deriveSpaceOnboardingPlan({
			authSession: { user: { id: "u1", name: "felix-oauth" } },
			actingProfileId: "h1",
			accountProfiles: [accountProfile()],
			membersSnapshot: { humans: [member({ profileId: "h1" })], agents: [] },
			spaceId: "s",
			deviceStatus: "not_connected",
		});

		const byId = new Map(
			plan.decisions.map((decision) => [decision.id, decision])
		);
		expect(byId.get("connect_this_computer")?.status).toBe("available");
		expect(byId.get("bring_agents")?.status).toBe("blocked");
	});

	it("marks bring_agents done from account profile membership even when member owner metadata lags", () => {
		const plan = deriveSpaceOnboardingPlan({
			authSession: { user: { id: "u1", name: "felix-oauth" } },
			actingProfileId: "h1",
			accountProfiles: [
				accountProfile(),
				accountProfile({
					openMeldProfileId: "a1",
					profileKind: "agent",
					profileName: "Codex",
				}),
			],
			membersSnapshot: {
				humans: [member({ profileId: "h1" })],
				agents: [member({ profileId: "a1", ownerUserId: null })],
			},
			spaceId: "s",
			deviceStatus: "connected",
		});

		const byId = new Map(
			plan.decisions.map((decision) => [decision.id, decision])
		);
		expect(byId.get("bring_agents")?.status).toBe("done");
		expect(byId.get("bring_agents")?.reason).toBe("agents.member_present");
	});

	it("marks bring_agents done when a managed Center Agent is already in the Space", () => {
		const plan = deriveSpaceOnboardingPlan({
			authSession: { user: { id: "u1", name: "Felix" } },
			actingProfileId: "h1",
			accountProfiles: [accountProfile()],
			membersSnapshot: {
				humans: [member({ profileId: "h1" })],
				agents: [
					member({
						profileId: "agt_center",
						ownerUserId: null,
					}),
				],
			},
			spaceId: "s",
			deviceStatus: "connected",
		});

		const byId = new Map(
			plan.decisions.map((decision) => [decision.id, decision])
		);
		expect(byId.get("bring_agents")?.status).toBe("done");
		expect(byId.get("bring_agents")?.reason).toBe("agents.member_present");
	});

	it("prefers the acting profile's display name over the OAuth name", () => {
		const plan = deriveSpaceOnboardingPlan({
			authSession: { user: { id: "u1", name: "felix-oauth" } },
			actingProfileId: "h1",
			accountProfiles: [accountProfile({ profileName: "Felix" })],
			membersSnapshot: null,
			spaceId: "s",
			deviceStatus: "unknown",
		});

		const byId = new Map(
			plan.decisions.map((decision) => [decision.id, decision])
		);
		expect(byId.get("set_display_name")?.status).toBe("done");
	});
});
