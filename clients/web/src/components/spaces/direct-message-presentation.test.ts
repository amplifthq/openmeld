import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import {
	resolveDirectMessagePresentation,
	resolveDirectMessageSessionAgentProfileId,
} from "./direct-message-presentation";

const { enabled } = vi.hoisted(() => ({ enabled: { value: true } }));
vi.mock("#/lib/member-agents/member-agents-feature", () => ({
	isMemberAgentsEnabled: () => enabled.value,
}));

function member(userId: string, profileId: string, profileName: string) {
	return {
		userId,
		user: { id: userId, name: `${profileName} (account)` },
		humanProfile: { profileId, profileName, status: "active" },
	};
}

function agent(
	profileId: string,
	ownerUserId: string | null,
	profileName = "Claude Code"
) {
	return {
		profileId,
		profileName,
		status: "active",
		ownerUserId,
		agentControllerRef: "builtin:claude-code",
	};
}

const directory = {
	members: [
		member("u-felix", "h-felix", "Felix Smoke"),
		member("u-tali", "h-tali", "Tali Smoke"),
	],
	agentProfiles: [
		agent("a-felix-cc", "u-felix"),
		agent("a-tali-cc", "u-tali"),
		agent("a-tali-review", "u-tali", "Reviewer"),
		agent("a-center", null, "Center Agent"),
	],
} as unknown as OrganizationProfileDirectoryResponse;

function present(profileIds: string[], viewer: "felix" | "tali") {
	return resolveDirectMessagePresentation({
		item: {
			directMessageProfileIds: profileIds,
			spaceName: "Stored name",
		} as unknown as AccountSpaceItem,
		profileDirectory: directory,
		viewerProfileId: `h-${viewer}`,
		viewerUserId: `u-${viewer}`,
	});
}

describe("Direct Message presentation", () => {
	const human = createSpaceMemberHumanSnapshot({
		profileId: "h-felix",
		ownerUserId: "u-felix",
	});
	const colleagueAgent = createSpaceMemberAgentSnapshot({
		profileId: "a-tali-cc",
		ownerUserId: "u-tali",
	});
	const session = createSpaceMembersSnapshot({
		humans: [human],
		agents: [colleagueAgent],
	});
	it.each([
		{
			name: "the Human chatting with their own Agent",
			input: {
				snapshot: createSpaceMembersSnapshot({
					humans: [human],
					agents: [{ ...colleagueAgent, ownerUserId: "u-felix" }],
				}),
			},
			expected: "a-tali-cc",
		},
		{
			name: "the Human chatting with a colleague's Agent",
			input: {},
			expected: "a-tali-cc",
		},
		{
			name: "an observer outside the Human-Agent pair",
			input: { viewerProfileId: "h-observer" },
			expected: null,
		},
		{
			name: "a Human-Human Direct Message",
			input: {
				snapshot: createSpaceMembersSnapshot({
					humans: [
						human,
						createSpaceMemberHumanSnapshot({ profileId: "h-tali" }),
					],
				}),
			},
			expected: null,
		},
		{
			name: "a converted Space retaining its former pair",
			input: { isDirectMessage: false },
			expected: null,
		},
		{
			name: "a Center Agent Direct Message",
			input: { isCenterAgentDirectMessage: true },
			expected: null,
		},
		{
			name: "unavailable membership evidence",
			input: { snapshot: null },
			expected: null,
		},
		{
			name: "MemberAgents disabled",
			input: {},
			enabled: false,
			expected: null,
		},
	])("selects Session controls for $name", (testCase) => {
		enabled.value = testCase.enabled !== false;
		try {
			expect(
				resolveDirectMessageSessionAgentProfileId({
					isDirectMessage: true,
					isCenterAgentDirectMessage: false,
					viewerProfileId: human.profileId,
					snapshot: session,
					...testCase.input,
				})
			).toBe(testCase.expected);
		} finally {
			enabled.value = true;
		}
	});

	it("names another member's Agent with its owner", () => {
		const presentation = present(["h-felix", "a-tali-cc"], "felix");
		expect(presentation.name).toBe("Tali Smoke’s Claude Code");
		// The stored Profile name stays the identity and mention target.
		expect(presentation.peer?.profileName).toBe("Claude Code");
	});

	it("keeps the viewer's own Agent and org-owned Agents as they are", () => {
		expect(present(["h-tali", "a-tali-cc"], "tali").name).toBe("Claude Code");
		expect(present(["h-felix", "a-felix-cc"], "felix").name).toBe(
			"Claude Code"
		);
		expect(present(["h-felix", "a-center"], "felix").name).toBe("Center Agent");
	});

	it("adds a non-default Profile's name after the owner's Agent", () => {
		expect(present(["h-felix", "a-tali-review"], "felix").name).toBe(
			"Tali Smoke’s Claude Code · Reviewer"
		);
	});

	it("names a pair the viewer is not in, skipping an owner already named", () => {
		expect(present(["h-tali", "a-tali-cc"], "felix").name).toBe(
			"Tali Smoke and Claude Code"
		);
		expect(present(["h-tali", "a-felix-cc"], "felix").name).toBe(
			"Tali Smoke and Claude Code"
		);
		expect(present(["a-tali-cc", "a-felix-cc"], "felix").name).toBe(
			"Tali Smoke’s Claude Code and Claude Code"
		);
	});

	it("leaves names unchanged while MemberAgents are off", () => {
		enabled.value = false;
		try {
			expect(present(["h-felix", "a-tali-cc"], "felix").name).toBe(
				"Claude Code"
			);
		} finally {
			enabled.value = true;
		}
	});
});
