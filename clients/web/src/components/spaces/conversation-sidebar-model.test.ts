import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import {
	type Conversation,
	conversationSectionId,
	conversationSections,
	moveConversationPreferences,
	sortConversations,
} from "./conversation-sidebar-model";

const preferences: AccountSidebarPreferences = {
	pinned: { sort: "priority", spaceIds: ["space-pin", "dm-pin", "hidden"] },
	spaces: { sort: "manual", spaceIds: ["space"] },
	groups: [{ id: "work", name: "Work", sort: "manual", spaceIds: ["space"] }],
};
const chats = {
	...EMPTY_CHAT_PREFERENCES,
	pinned: { sort: "manual" as const, spaceIds: ["dm-pin", "session"] },
	groups: [
		{ id: "work", name: "People", sort: "manual" as const, spaceIds: ["dm"] },
	],
};
const sections = conversationSections(preferences, chats);
function conversation(
	id: string,
	kind: "space" | "direct-message",
	activity: number,
	pinned = false
): Conversation {
	const base = {
		spaceId: id,
		title: id,
		activity,
		url: `/${id}`,
		profileId: "human",
	};
	if (kind === "direct-message") {
		return { ...base, kind, chat: { spaceId: id, name: id, createdAt: null } };
	}
	const item: AccountSpaceItem = {
		spaceId: id,
		spaceName: id,
		spacePurpose: null,
		organizationId: "org",
		pinnedAt: pinned ? "2026-09-01" : null,
		pinnedProfileIds: [],
		lastJoinedAt: "2026-09-10",
		joinedProfiles: [],
		openProfileId: "human",
		openProfileName: "Human",
		visibility: "private",
		activeAgentCount: 0,
		activeHumanCount: 1,
		activeMemberCount: 1,
	};
	return { ...base, kind, item };
}

describe("conversation navigation", () => {
	it("keeps existing groups separate even when their saved IDs match", () => {
		expect(sections.map((section) => section.id)).toEqual([
			"pinned",
			"space:work",
			"spaces",
			"chat:work",
			"chats",
		]);
		expect(
			conversationSectionId(
				conversation("space", "space", 0),
				sections,
				chats.pinned.spaceIds
			)
		).toBe("space:work");
		expect(
			conversationSectionId(
				conversation("dm", "direct-message", 0),
				sections,
				chats.pinned.spaceIds
			)
		).toBe("chat:work");
	});
	it("reads ordinary Space pin membership from the index, never from saved order", () => {
		expect(
			conversationSectionId(
				conversation("space-pin", "space", 0),
				sections,
				chats.pinned.spaceIds
			)
		).toBe("spaces");
		expect(
			conversationSectionId(
				conversation("space-pin", "space", 0, true),
				sections,
				chats.pinned.spaceIds
			)
		).toBe("pinned");
	});
	it("keeps one stable mixed Pinned order regardless of unread or activity", () => {
		const items = [
			conversation("session", "direct-message", 500),
			conversation("dm-pin", "direct-message", 300),
			conversation("space-pin", "space", 1, true),
		];
		expect(
			sortConversations(
				items,
				sections[0],
				new Set(["session"]),
				new Map([["dm-pin", 2]]),
				new Set()
			).map((item) => item.spaceId)
		).toEqual(["space-pin", "dm-pin", "session"]);
	});
	it("Recent uses message time across types, including an unread old conversation", () => {
		const items = [
			conversation("unread", "space", 1),
			conversation("dm", "direct-message", 10),
			conversation("empty", "space", 0),
			conversation("space", "space", 20),
		];
		expect(
			sortConversations(
				items,
				{ id: "recent", sort: "recent", spaceIds: [] },
				new Set(),
				new Map([["unread", 999]]),
				new Set(["empty"])
			).map((item) => item.spaceId)
		).toEqual(["space", "dm", "unread", "empty"]);
	});
	it("shared pin ordering preserves hidden pins and a conversation's saved group", () => {
		const next = moveConversationPreferences({
			preferences,
			chats,
			conversation: conversation("dm", "direct-message", 1),
			target: sections[0],
			visibleIds: ["space-pin", "dm-pin"],
			beforeId: "dm-pin",
		});
		expect(next.pinned.spaceIds).toEqual([
			"space-pin",
			"dm",
			"dm-pin",
			"hidden",
			"session",
		]);
		expect(next.chats?.pinned.spaceIds).toContain("dm");
		expect(next.chats?.groups).toEqual(chats.groups);
		expect(next.groups).toEqual(preferences.groups);
	});
	it("rejects moving a Space into a direct-message group", () => {
		expect(
			moveConversationPreferences({
				preferences,
				chats,
				conversation: conversation("space", "space", 1),
				target: sections[3],
				visibleIds: [],
			})
		).toBe(preferences);
	});
	it("unpinning through a group move only changes the matching preference owner", () => {
		const next = moveConversationPreferences({
			preferences,
			chats,
			conversation: conversation("dm-pin", "direct-message", 1),
			target: sections[3],
			visibleIds: ["dm"],
		});
		expect(next.pinned.spaceIds).toEqual(["space-pin", "hidden"]);
		expect(next.chats?.pinned.spaceIds).toEqual(["session"]);
		expect(next.chats?.groups[0].spaceIds).toEqual(["dm", "dm-pin"]);
		expect(next.groups).toEqual(preferences.groups);
	});
});
