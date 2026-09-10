import { describe, expect, it } from "vitest";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import {
	agentConversationLink,
	selectAgentConversations,
} from "./agent-conversations";
import type { DirectoryAgentProfileSummary } from "./directory-human-profile-model";

const agent: DirectoryAgentProfileSummary = {
	id: "my-agent",
	name: "Research",
	agentControllerRef: "codex",
	avatarImageUrl: null,
	modelSelection: null,
	modelSelectionIsKnown: true,
	path: "/agent",
};
function space(id: string, profiles = [agent.id]): AccountSpaceItem {
	return {
		spaceId: id,
		spaceName: "Research discussion",
		organizationId: "org",
		openProfileId: profiles[0],
		openProfileName: "Research",
		joinedProfiles: profiles.map((profileId) => ({
			profileId,
			profileName: profileId,
			lastJoinedAt: "2026-09-09T00:00:00Z",
			pinnedAt: null,
		})),
		lastJoinedAt: "2026-09-09T00:00:00Z",
		pinnedAt: null,
		pinnedProfileIds: [],
		visibility: "private",
		spacePurpose: "openmeld_dm_space",
		activeAgentCount: 1,
		activeHumanCount: 1,
		activeMemberCount: 2,
		messagePreview: {
			signalId: "message",
			profileId: "person",
			timestamp: 100,
			text: "Hello",
		},
	};
}

describe("owned Agent conversations", () => {
	it("includes Agent membership without requiring the Human to join, deduplicates, and sorts by the latest message", () => {
		const older = space("older");
		const newer = {
			...space("newer"),
			messagePreview: {
				signalId: "new-message",
				profileId: "person",
				text: "New update",
				timestamp: 200,
			},
		};
		const rows = selectAgentConversations({
			organizationId: "org",
			agents: [agent],
			sections: { pinnedItems: [older], spaceItems: [older, newer] },
		});
		expect(rows.map((row) => row.space.spaceId)).toEqual(["newer", "older"]);
	});
	it("excludes other organizations, Human-only conversations and Agents not currently owned", () => {
		const rows = selectAgentConversations({
			organizationId: "org",
			agents: [agent],
			sections: {
				pinnedItems: [],
				spaceItems: [
					{ ...space("other-org"), organizationId: "other" },
					space("human-only", ["me"]),
					space("other-agent", ["former-agent"]),
					space("mine"),
				],
			},
		});
		expect(rows.map((row) => row.space.spaceId)).toEqual(["mine"]);
	});
	it("keeps all owned Agents in a shared conversation in one row", () => {
		const rows = selectAgentConversations({
			organizationId: "org",
			agents: [agent, { ...agent, id: "second" }],
			sections: {
				pinnedItems: [],
				spaceItems: [space("shared", [agent.id, "second"])],
			},
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].agents.map((item) => item.id)).toEqual([agent.id, "second"]);
	});
	it("reuses the represented profile for an owner observer and the Human after joining", () => {
		const observer = agentConversationLink({
			conversation: { space: space("dm"), agents: [agent] },
			humanProfileId: "me",
			orgSlug: "studio",
		});
		expect(observer).toEqual({
			to: "/o/studio/chats/dm",
			search: { profileId: "my-agent" },
		});
		const joined = {
			...space("converted", ["me", agent.id]),
			directMessageConvertedAt: "2026-09-09T00:00:00Z",
		};
		expect(
			agentConversationLink({
				conversation: { space: joined, agents: [agent] },
				humanProfileId: "me",
				orgSlug: "studio",
			})
		).toEqual({
			to: "/o/studio/spaces/converted",
			search: { profileId: "me" },
		});
	});
});
