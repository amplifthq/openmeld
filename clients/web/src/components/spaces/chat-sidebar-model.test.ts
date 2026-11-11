import { describe, expect, it } from "vitest";
import {
	type Chat,
	isChatArchived,
	mergeChatPreferences,
} from "./chat-sidebar-model";
import { sortSidebarSpaces } from "./sidebar-space-order";

describe("unified Chats", () => {
	it.each([
		"owner",
		"colleague",
	])("uses Core archive state for %s Agent chats even when old preferences disagree", (ownerUserId) => {
		const chat = {
			spaceId: "agent-chat",
			name: "Work",
			createdAt: null,
			peer: {
				profileId: "agent",
				profileKind: "agent",
				profileName: "Agent",
				displayName: "Agent",
				agentControllerRef: "builtin:codex",
				avatarUrl: null,
				ownerUserId,
			},
		} satisfies Chat;
		expect(
			isChatArchived({
				chat,
				memberAgentsEnabled: true,
				personalArchivedIds: [],
				sessionArchivedIds: new Set([chat.spaceId]),
			})
		).toBe(true);
		expect(
			isChatArchived({
				chat,
				memberAgentsEnabled: true,
				personalArchivedIds: [chat.spaceId],
				sessionArchivedIds: new Set(),
			})
		).toBe(false);
		// Disabling MemberAgents and other chat kinds retain personal archiving.
		for (const input of [
			{ chat, memberAgentsEnabled: false },
			{ chat: { ...chat, session: true }, memberAgentsEnabled: true },
			{
				chat: {
					...chat,
					peer: { ...chat.peer, profileKind: "human" as const },
				},
				memberAgentsEnabled: true,
			},
		]) {
			expect(
				isChatArchived({
					...input,
					personalArchivedIds: [chat.spaceId],
					sessionArchivedIds: new Set(),
				})
			).toBe(true);
		}
	});
	it("preserves Space Index pins even without legacy list settings and respects unpinning", () => {
		const initial = mergeChatPreferences(undefined, [
			{ spaceId: "person", pinnedAt: "2026-09-09" },
		]);
		expect(initial.pinned.spaceIds).toEqual(["person"]);
		const preferences = {
			pinned: { sort: "priority" as const, spaceIds: [] },
			spaces: { sort: "priority" as const, spaceIds: [] },
			groups: [],
			chats: initial,
		};
		expect(
			mergeChatPreferences(preferences, [{ spaceId: "person", pinnedAt: null }])
				.pinned.spaceIds
		).toEqual([]);
		expect(
			mergeChatPreferences(preferences, [
				{ spaceId: "person", pinnedAt: "2026-09-09" },
				{ spaceId: "agent", pinnedAt: "2026-09-09" },
			]).pinned.spaceIds
		).toEqual(["person", "agent"]);
	});
	it("defaults to priority and preserves both former lists' manual order and groups", () => {
		expect(mergeChatPreferences(undefined, []).spaces.sort).toBe("priority");
		const groupId = "11111111-1111-4111-8111-111111111111";
		const result = mergeChatPreferences(
			{
				pinned: { sort: "priority", spaceIds: [] },
				spaces: { sort: "priority", spaceIds: [] },
				groups: [],
				chats: {
					pinned: { sort: "manual", spaceIds: ["remote"] },
					spaces: { sort: "manual", spaceIds: ["remote"] },
					groups: [
						{ id: groupId, name: "Work", sort: "manual", spaceIds: ["remote"] },
					],
					archivedIds: ["archived"],
					titles: { remote: "Custom title" },
				},
				messages: {
					pinned: { sort: "manual", spaceIds: ["local"] },
					spaces: { sort: "manual", spaceIds: ["local", "person"] },
					groups: [
						{ id: groupId, name: "Work", sort: "manual", spaceIds: ["local"] },
					],
				},
			},
			[]
		);
		expect(result.pinned.spaceIds).toEqual(["remote", "local"]);
		expect(result.groups[0]?.spaceIds).toEqual(["remote", "local"]);
		expect(result.spaces).toEqual({
			sort: "manual",
			spaceIds: ["remote", "local", "person"],
		});
		expect(result.archivedIds).toEqual(["archived"]);
		expect(result.titles.remote).toBe("Custom title");
	});
	it("sorts mixed conversation kinds together by activity and priority", () => {
		const items = ["remote", "local", "person"].map((spaceId) => ({
			spaceId,
			pinnedAt: null,
			lastJoinedAt: "",
			spaceCreatedAt: null,
			spaceUpdatedAt: null,
		}));
		const activity = new Map([
			["remote", 100],
			["local", 300],
			["person", 200],
		]);
		const recent = sortSidebarSpaces(
			items,
			{ sort: "recent", spaceIds: [] },
			undefined,
			undefined,
			undefined,
			activity
		);
		expect(recent.map((item) => item.spaceId)).toEqual([
			"local",
			"person",
			"remote",
		]);
		const priority = sortSidebarSpaces(
			items,
			{ sort: "priority", spaceIds: [] },
			new Set(["remote"]),
			new Map([["person", 200]]),
			undefined,
			activity
		);
		expect(priority.map((item) => item.spaceId)).toEqual([
			"remote",
			"person",
			"local",
		]);
	});
});
