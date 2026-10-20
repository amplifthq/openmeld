import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import type { SpaceStatusSources } from "#/components/spaces/space-status-indicators";
import { useActiveMemberAgentSessionList } from "./member-agent-session-nav";

const noStatus: SpaceStatusSources = {
	unreadBySpaceId: new Map(),
	activeWakeSummaryBySpaceId: new Map(),
	attentionById: new Map(),
};

const { sessionGroups } = vi.hoisted(() => ({ sessionGroups: vi.fn() }));
vi.mock("./use-member-agents", () => ({
	useMemberAgentIndex: () => ({
		index: {
			byId: new Map([
				["ma-1", { displayName: "Codex", memberAgent: { id: "ma-1" } }],
			]),
		},
	}),
}));
vi.mock("./member-agent-chat-history", () => ({
	useMemberAgentSessionGroups: sessionGroups,
}));

const active = {
	kind: "direct-message",
	spaceId: "s-1",
	memberAgentId: "ma-1",
	chat: { peer: { profileId: "p-default" } },
} as unknown as Conversation;

it("lists the open MemberAgent's Sessions by Profile to nest under its row", () => {
	sessionGroups.mockReturnValue({
		sessionPath: (spaceId: string) => `/dm/${spaceId}`,
		groups: [
			{
				id: "p-default",
				label: "Codex",
				isError: false,
				items: [{ spaceId: "s-1", title: "Plan" }],
			},
			{
				id: "p-review",
				label: "Codex · Review",
				isError: true,
				items: [{ spaceId: "s-2", title: "Audit" }],
			},
		],
	});
	const { result } = renderHook(() =>
		useActiveMemberAgentSessionList(active, noStatus)
	);
	expect(sessionGroups).toHaveBeenCalledWith(
		expect.objectContaining({
			currentProfileId: "p-default",
			spaceId: "s-1",
			includeAll: true,
		})
	);
	expect(result.current?.memberAgentId).toBe("ma-1");
	expect(
		result.current?.sections.map((section) => ({
			label: section.label,
			notice: section.notice,
			items: section.items.map((item) => [item.id, item.label, item.to]),
		}))
	).toEqual([
		{ label: "Codex", notice: undefined, items: [["s-1", "Plan", "/dm/s-1"]] },
		{
			label: "Codex · Review",
			notice: "Couldn’t load chats.",
			items: [["s-2", "Audit", "/dm/s-2"]],
		},
	]);
});

it("adds nothing outside a MemberAgent Session", () => {
	sessionGroups.mockReturnValue({ sessionPath: String, groups: [] });
	const { result } = renderHook(() =>
		useActiveMemberAgentSessionList(undefined, noStatus)
	);
	expect(result.current).toBeNull();
});

it("names each Session's own status so other Sessions are not missed", () => {
	sessionGroups.mockReturnValue({
		sessionPath: (spaceId: string) => `/dm/${spaceId}`,
		groups: [
			{
				id: "p-default",
				label: "Codex",
				isError: false,
				items: [
					{ spaceId: "s-idle", title: "Idle" },
					{ spaceId: "s-unread", title: "Unread" },
					{ spaceId: "s-approval", title: "Approval" },
				],
			},
		],
	});
	const { result } = renderHook(() =>
		useActiveMemberAgentSessionList(active, {
			unreadBySpaceId: new Map([["s-unread", { unreadCount: 2 }]]),
			activeWakeSummaryBySpaceId: new Map([
				[
					"s-approval",
					{
						spaceId: "s-approval",
						activeWakeCount: 1,
						statuses: [
							{
								kind: "needs_input",
								label: "Codex needs your input",
								description: "",
								status: "pending",
							},
						],
					},
				],
			]),
			attentionById: new Map([["s-approval", { unresolvedActionCount: 1 }]]),
		})
	);
	expect(
		result.current?.sections[0]?.items.map((item) => item.ariaLabel)
	).toEqual([
		undefined,
		"Unread, unread updates",
		"Approval, Priority attention, Codex needs your input",
	]);
});
