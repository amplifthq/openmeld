import { describe, expect, it } from "vitest";
import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import { MIGRATED_LISTING } from "#/test-support/member-agent-fixtures";
import { groupMemberAgentConversations } from "./member-agent-conversations";
import { buildMemberAgentIndex } from "./member-agent-index";

const index = buildMemberAgentIndex({
	listing: MIGRATED_LISTING,
	ownerName: "Felix Lu",
});

function directMessage(
	spaceId: string,
	peer: { profileId: string; profileKind: "agent" | "human" },
	activity: number,
	extra: { session?: boolean } = {}
): Conversation {
	return {
		kind: "direct-message",
		spaceId,
		title: spaceId,
		activity,
		url: `/dm/${spaceId}`,
		profileId: "human-felix",
		chat: {
			spaceId,
			name: spaceId,
			peer: { ...peer, profileName: peer.profileId },
			...extra,
		},
	} as unknown as Conversation;
}

const conversations: Conversation[] = [
	directMessage(
		"dm-claude-1",
		{ profileId: "agt-claude-default", profileKind: "agent" },
		10
	),
	directMessage(
		"dm-claude-2",
		{ profileId: "agt-claude-default", profileKind: "agent" },
		30
	),
	directMessage(
		"dm-reviewer",
		{ profileId: "agt-claude-reviewer", profileKind: "agent" },
		20
	),
	directMessage(
		"dm-codex",
		{ profileId: "agt-codex", profileKind: "agent" },
		5
	),
	directMessage(
		"dm-tali",
		{ profileId: "human-tali", profileKind: "human" },
		7
	),
	directMessage(
		"dm-colleague-agent",
		{ profileId: "agt-tali-codex", profileKind: "agent" },
		8
	),
	directMessage(
		"center-1",
		{ profileId: "agt-center", profileKind: "agent" },
		9,
		{ session: true }
	),
];

describe("MemberAgent Direct Message rows", () => {
	it("shows one row per MemberAgent, not per Profile or Session", () => {
		const rows = groupMemberAgentConversations({
			conversations,
			index,
			selectedSpaceId: null,
		});
		expect(rows.map((row) => [row.spaceId, row.title])).toEqual([
			["dm-claude-2", "Felix Lu’s Claude Code"],
			["dm-codex", "Felix Lu’s Codex"],
			["dm-tali", "dm-tali"],
			["dm-colleague-agent", "dm-colleague-agent"],
			["center-1", "center-1"],
		]);
		expect(rows[0]?.activity).toBe(30);
	});

	it("opens the selected Session when it belongs to the MemberAgent", () => {
		const rows = groupMemberAgentConversations({
			conversations,
			index,
			selectedSpaceId: "dm-reviewer",
		});
		expect(rows[0]).toMatchObject({
			spaceId: "dm-reviewer",
			title: "Felix Lu’s Claude Code",
		});
	});
});
