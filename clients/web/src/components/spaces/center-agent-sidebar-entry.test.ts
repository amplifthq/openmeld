import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import {
	aliasSpaceIds,
	centerAgentEntryTitle,
	collapseCenterAgentSessions,
	keepOnlyCenterAgentEntryPosition,
	mergeActiveWakeSummaries,
	mergeBySidebarEntry,
} from "./center-agent-sidebar-entry";
import {
	type Conversation,
	conversationSections,
} from "./conversation-sidebar-model";

function session(
	id: string,
	activity: number,
	agent = "center",
	agentName?: string
): Conversation {
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
			centerAgentProfileName: agentName,
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

describe("center-agent sidebar entry", () => {
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
		const noUnread = new Map<string, number>();

		it("shows active sessions as one entry that opens the latest one", () => {
			const result = collapseCenterAgentSessions({
				conversations: [
					session("a", 1),
					directMessage("dm"),
					session("b", 3),
					session("archived", 9),
				],
				archivedIds: ["archived"],
				latestUnreadAtBySpaceId: noUnread,
				title: "Felix’s Center Agent",
			});
			expect(result.conversations.map((item) => item.spaceId)).toEqual([
				"dm",
				"archived",
				"b",
			]);
			expect(result.conversations.at(-1)).toMatchObject({
				spaceId: "b",
				title: "Felix’s Center Agent",
				url: "/b",
				sessionSpaceIds: ["a", "b"],
			});
			expect([...result.entryIdBySessionId]).toEqual([
				["a", "b"],
				["b", "b"],
			]);
		});

		it("opens the newest unread session but sorts by the latest activity", () => {
			const result = collapseCenterAgentSessions({
				conversations: [session("a", 1), session("b", 3), session("c", 2)],
				archivedIds: [],
				latestUnreadAtBySpaceId: new Map([
					["a", 20],
					["c", 10],
				]),
				title: "Center Agent",
			});
			expect(result.conversations[0]).toMatchObject({
				spaceId: "a",
				url: "/a",
				activity: 3,
			});
		});

		it("keeps separate Center Agents apart", () => {
			const result = collapseCenterAgentSessions({
				conversations: [session("a", 1, "one"), session("b", 2, "two", "Ops")],
				archivedIds: [],
				latestUnreadAtBySpaceId: noUnread,
				title: "Center Agent",
			});
			expect(
				result.conversations.map(({ spaceId, title }) => [spaceId, title])
			).toEqual([
				["a", "Center Agent"],
				["b", "Center Agent · Ops"],
			]);
		});
	});

	describe("aliasSpaceIds", () => {
		it("moves an older session's saved position onto its entry", () => {
			const entries = new Map([
				["a", "b"],
				["b", "b"],
			]);
			const chats = {
				...EMPTY_CHAT_PREFERENCES,
				pinned: { sort: "manual" as const, spaceIds: ["a"] },
			};
			const pinned = conversationSections(
				{
					...preferences,
					pinned: { sort: "manual", spaceIds: ["x", "a", "b"] },
				},
				chats
			)[0];
			expect(aliasSpaceIds(pinned?.spaceIds ?? [], entries)).toEqual([
				"x",
				"b",
			]);
		});
	});

	describe("mergeActiveWakeSummaries", () => {
		it("counts every session's Wakes and keeps their statuses", () => {
			const merged = mergeActiveWakeSummaries(
				{
					spaceId: "a",
					activeWakeCount: 1,
					activeTargets: [
						{ profileId: "center", profileName: "Center", activeWakeCount: 1 },
					],
				},
				{
					spaceId: "b",
					activeWakeCount: 2,
					activeTargets: [
						{ profileId: "center", profileName: null, activeWakeCount: 2 },
					],
					statuses: [{ kind: "needs_input" } as never],
				}
			);
			expect(merged).toMatchObject({
				activeWakeCount: 3,
				activeTargets: [
					{ profileId: "center", profileName: "Center", activeWakeCount: 3 },
				],
				statuses: [{ kind: "needs_input" }],
			});
		});

		it("keeps the Space of the session waiting on the viewer", () => {
			const merged = mergeActiveWakeSummaries(
				{ spaceId: "a", activeWakeCount: 1, focusSignalId: "signal-a" },
				{
					spaceId: "b",
					activeWakeCount: 1,
					focusSignalId: "signal-b",
					statuses: [{ kind: "needs_input" } as never],
				}
			);
			expect(merged).toMatchObject({
				spaceId: "b",
				focusSignalId: "signal-b",
				activeWakeCount: 2,
			});
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
});
