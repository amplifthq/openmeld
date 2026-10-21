import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	readMemberAgentLastChat,
	readRememberedProfileChat,
	rememberMemberAgentChat,
	resolveMemberAgentLastChat,
} from "./member-agent-last-chat";

const { listSessions } = vi.hoisted(() => ({ listSessions: vi.fn() }));
vi.mock("#/query/organizations/agent-direct-message-sessions", () => ({
	agentDirectMessageSessionsQueryOptions: (input: {
		agentProfileId: string;
	}) => ({
		queryKey: ["sessions", input.agentProfileId],
		queryFn: () => listSessions(input.agentProfileId),
	}),
}));

const felix = { organizationId: "org-1", humanProfileId: "human-felix" };
const tali = { organizationId: "org-1", humanProfileId: "human-tali" };

beforeEach(() => {
	window.localStorage.clear();
});
afterEach(() => {
	vi.restoreAllMocks();
});

it("remembers the chat for its MemberAgent and its Profile, per member", () => {
	rememberMemberAgentChat(felix, {
		memberAgentId: "ma-claude",
		agentProfileId: "p-default",
		spaceId: "s-7",
	});
	expect(readMemberAgentLastChat(felix, { memberAgentId: "ma-claude" })).toBe(
		"s-7"
	);
	expect(readMemberAgentLastChat(felix, { agentProfileId: "p-default" })).toBe(
		"s-7"
	);
	expect(readMemberAgentLastChat(tali, { memberAgentId: "ma-claude" })).toBe(
		null
	);
});

it("restores the remembered chat while it is still listed", () => {
	rememberMemberAgentChat(felix, {
		memberAgentId: "ma-claude",
		agentProfileId: "p-default",
		spaceId: "s-7",
	});
	expect(
		resolveMemberAgentLastChat({
			scope: felix,
			target: { memberAgentId: "ma-claude" },
			available: ["s-1", "s-7"],
			complete: true,
		})
	).toBe("s-7");
});

it("falls back and clears a stale entry only once the list is complete", () => {
	rememberMemberAgentChat(felix, {
		memberAgentId: "ma-claude",
		agentProfileId: "p-default",
		spaceId: "s-gone",
	});
	const target = { memberAgentId: "ma-claude" };
	// A partial list may still hold it: no answer, but nothing is lost.
	expect(
		resolveMemberAgentLastChat({
			scope: felix,
			target,
			available: ["s-1"],
			complete: false,
		})
	).toBeNull();
	expect(readMemberAgentLastChat(felix, target)).toBe("s-gone");
	expect(
		resolveMemberAgentLastChat({
			scope: felix,
			target,
			available: ["s-1"],
			complete: true,
		})
	).toBeNull();
	expect(readMemberAgentLastChat(felix, target)).toBeNull();
});

it("keeps one remembered chat per Profile of a MemberAgent", () => {
	rememberMemberAgentChat(felix, {
		memberAgentId: "ma-cursor",
		agentProfileId: "p-default",
		spaceId: "s-default",
	});
	rememberMemberAgentChat(felix, {
		memberAgentId: "ma-cursor",
		agentProfileId: "p-moved",
		spaceId: "s-moved",
	});
	// The Agent row follows the latest choice; each Profile keeps its own.
	expect(readMemberAgentLastChat(felix, { memberAgentId: "ma-cursor" })).toBe(
		"s-moved"
	);
	expect(readMemberAgentLastChat(felix, { agentProfileId: "p-default" })).toBe(
		"s-default"
	);
	expect(readMemberAgentLastChat(felix, { agentProfileId: "p-moved" })).toBe(
		"s-moved"
	);
});

it("checks a Profile's remembered chat against its Sessions before reopening it", async () => {
	const queryClient = new QueryClient();
	listSessions.mockResolvedValue({
		memberProfileId: "human-felix",
		nextCursor: null,
		sessions: [{ spaceId: "s-7" }],
	});
	expect(
		await readRememberedProfileChat({
			queryClient,
			scope: felix,
			agentProfileId: "p-default",
		})
	).toBeNull();
	// Nothing remembered: no Session read at all.
	expect(listSessions).not.toHaveBeenCalled();
	rememberMemberAgentChat(felix, {
		memberAgentId: "ma-claude",
		agentProfileId: "p-default",
		spaceId: "s-7",
	});
	expect(
		await readRememberedProfileChat({
			queryClient,
			scope: felix,
			agentProfileId: "p-default",
		})
	).toEqual({ spaceId: "s-7", memberProfileId: "human-felix" });
	queryClient.clear();
	listSessions.mockResolvedValue({
		memberProfileId: "human-felix",
		nextCursor: null,
		sessions: [{ spaceId: "s-1" }],
	});
	expect(
		await readRememberedProfileChat({
			queryClient,
			scope: felix,
			agentProfileId: "p-default",
		})
	).toBeNull();
	expect(readMemberAgentLastChat(felix, { agentProfileId: "p-default" })).toBe(
		null
	);
});
