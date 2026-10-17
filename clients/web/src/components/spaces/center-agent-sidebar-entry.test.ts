import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import {
	centerAgentEntryTitle,
	collapseCenterAgentSessions,
	keepOnlyCenterAgentEntryPosition,
	mergeBySidebarEntry,
} from "./center-agent-sidebar-entry";
import {
	type Conversation,
	conversationSections,
} from "./conversation-sidebar-model";

function session(id: string, activity: number, agent = "center"): Conversation {
	return {
		kind: "direct-message",
		spaceId: id,
		title: `Title ${id}`,
		activity,
		url: `/${id}`,
		profileId: "human",
		chat: {
			spaceId: id,
			name: id,
			createdAt: null,
			session: true,
			centerAgentProfileId: agent,
		},
	};
}

function directMessage(id: string): Conversation {
	return {
		kind: "direct-message",
		spaceId: id,
		title: id,
		activity: 1,
		url: `/${id}`,
		profileId: "human",
		chat: { spaceId: id, name: id, createdAt: null },
	};
}

const preferences: AccountSidebarPreferences = {
	pinned: { sort: "manual", spaceIds: [] },
	spaces: { sort: "manual", spaceIds: [] },
	groups: [],
};

describe("centerAgentEntryTitle", () => {
	it("names the viewer's private entry by full name", () => {
		expect(centerAgentEntryTitle(" Felix Johnson ")).toBe(
			"Felix Johnson’s Center Agent"
		);
		expect(centerAgentEntryTitle(" ")).toBe("Center Agent");
		expect(centerAgentEntryTitle(undefined)).toBe("Center Agent");
	});
});

describe("collapseCenterAgentSessions", () => {
	it("shows active sessions as one entry and keeps other rows", () => {
		const result = collapseCenterAgentSessions({
			conversations: [
				session("a", 1),
				directMessage("dm"),
				session("b", 3),
				session("archived", 9),
			],
			archivedIds: ["archived"],
			sections: [],
			title: "Felix’s Center Agent",
		});
		expect(result.conversations.map((item) => item.spaceId)).toEqual([
			"dm",
			"archived",
			"b",
		]);
		const entry = result.conversations.at(-1);
		expect(entry).toMatchObject({
			title: "Felix’s Center Agent",
			url: "/b",
			sessionSpaceIds: ["a", "b"],
			sessionTitles: ["Title a", "Title b"],
		});
		expect([...result.entryIdBySessionId]).toEqual([
			["a", "b"],
			["b", "b"],
		]);
	});

	it("keeps the saved position of an older session", () => {
		const chats = {
			...EMPTY_CHAT_PREFERENCES,
			pinned: { sort: "manual" as const, spaceIds: ["a"] },
		};
		const result = collapseCenterAgentSessions({
			conversations: [session("a", 1), session("b", 3)],
			archivedIds: [],
			sections: conversationSections(
				{ ...preferences, pinned: { sort: "manual", spaceIds: ["a"] } },
				chats
			),
			title: "Center Agent",
		});
		expect(result.conversations).toHaveLength(1);
		expect(result.conversations[0]).toMatchObject({
			spaceId: "a",
			url: "/b",
		});
	});

	it("keeps separate Center Agents apart", () => {
		const result = collapseCenterAgentSessions({
			conversations: [session("a", 1, "one"), session("b", 2, "two")],
			archivedIds: [],
			sections: [],
			title: "Center Agent",
		});
		expect(result.conversations.map((item) => item.spaceId)).toEqual([
			"a",
			"b",
		]);
	});
});

describe("mergeBySidebarEntry", () => {
	it("combines session evidence under the entry id", () => {
		const merged = mergeBySidebarEntry(
			new Map([
				["a", 1],
				["b", 2],
				["dm", 5],
			]),
			new Map([
				["a", "b"],
				["b", "b"],
			]),
			(current, next) => current + next
		);
		expect([...merged]).toEqual([
			["b", 3],
			["dm", 5],
		]);
	});
});

describe("keepOnlyCenterAgentEntryPosition", () => {
	it("drops the other sessions' pins, groups and order", () => {
		const next = keepOnlyCenterAgentEntryPosition(
			{
				...preferences,
				pinned: { sort: "manual", spaceIds: ["a", "space"] },
				chats: {
					...EMPTY_CHAT_PREFERENCES,
					pinned: { sort: "manual", spaceIds: ["a"] },
					spaces: { sort: "manual", spaceIds: ["b", "c", "dm"] },
					groups: [
						{ id: "g", name: "G", sort: "manual", spaceIds: ["c", "dm"] },
					],
				},
			},
			["a", "b", "c"],
			"b"
		);
		expect(next.pinned.spaceIds).toEqual(["space"]);
		expect(next.chats?.pinned.spaceIds).toEqual([]);
		expect(next.chats?.spaces.spaceIds).toEqual(["b", "dm"]);
		expect(next.chats?.groups[0]?.spaceIds).toEqual(["dm"]);
	});
});
