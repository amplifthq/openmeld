import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import { useActiveMemberAgentSessionNav } from "./member-agent-session-nav";

const { sessionGroups } = vi.hoisted(() => ({ sessionGroups: vi.fn() }));
vi.mock("./use-member-agents", () => ({
	useMemberAgentIndex: () => ({
		index: { byId: new Map([["ma-1", { displayName: "Codex" }]]) },
	}),
}));
vi.mock("./member-agent-chat-history", () => ({
	useMemberAgentSessionGroups: sessionGroups,
}));

it("lists the open MemberAgent's Sessions by Profile for one-click switching", () => {
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
				isError: false,
				items: [{ spaceId: "s-2", title: "Audit" }],
			},
		],
	});
	const active = {
		kind: "direct-message",
		spaceId: "s-1",
		memberAgentId: "ma-1",
		chat: { peer: { profileId: "p-default" } },
	} as unknown as Conversation;
	const { result } = renderHook(() => useActiveMemberAgentSessionNav(active));
	expect(sessionGroups).toHaveBeenCalledWith(
		expect.objectContaining({
			currentProfileId: "p-default",
			spaceId: "s-1",
			includeAll: true,
		})
	);
	expect(
		result.current.map((group) => ({
			label: group.label,
			items: group.items?.map((item) => [item.id, item.label, item.to]),
		}))
	).toEqual([
		{ label: "Codex", items: [["s-1", "Plan", "/dm/s-1"]] },
		{ label: "Codex · Review", items: [["s-2", "Audit", "/dm/s-2"]] },
	]);
});

it("adds nothing outside a MemberAgent Session", () => {
	sessionGroups.mockReturnValue({ sessionPath: String, groups: [] });
	const { result } = renderHook(() =>
		useActiveMemberAgentSessionNav(undefined)
	);
	expect(result.current).toEqual([]);
});
