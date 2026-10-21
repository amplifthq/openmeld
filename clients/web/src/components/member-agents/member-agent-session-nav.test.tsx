import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import type { SpaceStatusSources } from "#/components/spaces/space-status-indicators";
import { rememberMemberAgentChat } from "./member-agent-last-chat";
import { useActiveMemberAgentSessionList } from "./member-agent-session-nav";

const noStatus: SpaceStatusSources = {
	unreadBySpaceId: new Map(),
	activeWakeSummaryBySpaceId: new Map(),
	attentionById: new Map(),
};

const { sessionGroups, openChat, navigate } = vi.hoisted(() => ({
	sessionGroups: vi.fn(),
	openChat: vi.fn(),
	navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("./member-agent-last-chat", async (importOriginal) => ({
	...(await importOriginal<typeof import("./member-agent-last-chat")>()),
	useMemberAgentLastChatScope: () => ({
		organizationId: "org-1",
		humanProfileId: "human-felix",
	}),
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({ currentOrganization: { id: "org-1" } }),
}));
vi.mock("./use-member-agents", () => ({
	useMemberAgentIndex: () => ({
		index: {
			byId: new Map([
				["ma-1", { displayName: "Codex", memberAgent: { id: "ma-1" } }],
			]),
		},
	}),
}));
vi.mock("./member-agent-chat-history", async (importOriginal) => ({
	sortChatsByActivity: (
		await importOriginal<typeof import("./member-agent-chat-history")>()
	).sortChatsByActivity,
	openMemberAgentChat: openChat,
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
				profileName: "Codex",
				isError: false,
				items: [
					{ spaceId: "s-1", title: "Plan", timestamp: 10 },
					{ spaceId: "s-3", title: "Ship", timestamp: 30 },
				],
			},
			{
				id: "p-review",
				label: "Codex · Review",
				profileName: "Review",
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
			row: [section.row?.label, section.row?.to],
			notice: section.notice,
			items: section.items.map((item) => [item.id, item.label, item.to]),
		}))
	).toEqual([
		{
			// A Profile row names only the Profile and opens its latest chat.
			row: ["Codex", "/dm/s-3"],
			notice: undefined,
			items: [
				["s-3", "Ship", "/dm/s-3"],
				["s-1", "Plan", "/dm/s-1"],
			],
		},
		{
			row: ["Review", "/dm/s-2"],
			notice: "Couldn’t load chats.",
			items: [["s-2", "Audit", "/dm/s-2"]],
		},
	]);
});

it("starts a chat from a Profile row that has none", async () => {
	openChat.mockResolvedValue("s-new");
	sessionGroups.mockReturnValue({
		sessionPath: (spaceId: string) => `/dm/${spaceId}`,
		groups: [
			{
				id: "p-default",
				label: "Codex",
				profileName: "Codex",
				isError: false,
				items: [{ spaceId: "s-1", title: "Plan" }],
			},
			{
				id: "p-review",
				label: "Codex · Review",
				profileName: "Review",
				isError: false,
				items: [],
			},
		],
	});
	const { result } = renderHook(() =>
		useActiveMemberAgentSessionList(active, noStatus)
	);
	const row = result.current?.sections[1]?.row;
	expect(row?.to).toBeUndefined();
	act(() => row?.onSelect?.());
	expect(openChat).toHaveBeenCalledWith({
		organizationId: "org-1",
		agentProfileId: "p-review",
	});
	await waitFor(() =>
		expect(navigate).toHaveBeenCalledWith({ to: "/dm/s-new" })
	);
});

it("lists one Profile's chats without a Profile row", () => {
	sessionGroups.mockReturnValue({
		sessionPath: (spaceId: string) => `/dm/${spaceId}`,
		groups: [
			{
				id: "p-default",
				label: "Codex",
				profileName: "Codex",
				isError: false,
				items: [{ spaceId: "s-1", title: "Plan" }],
			},
		],
	});
	const { result } = renderHook(() =>
		useActiveMemberAgentSessionList(active, noStatus)
	);
	expect(result.current?.sections[0]?.row).toBeUndefined();
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

it("reopens the chat last opened with each Profile from its row", () => {
	window.localStorage.clear();
	rememberMemberAgentChat(
		{ organizationId: "org-1", humanProfileId: "human-felix" },
		{ memberAgentId: "ma-1", agentProfileId: "p-default", spaceId: "s-1" }
	);
	sessionGroups.mockReturnValue({
		sessionPath: (spaceId: string) => `/dm/${spaceId}`,
		groups: [
			{
				id: "p-default",
				label: "Codex",
				profileName: "Codex",
				isError: false,
				items: [
					{ spaceId: "s-1", title: "Plan", timestamp: 10 },
					{ spaceId: "s-3", title: "Ship", timestamp: 30 },
				],
			},
			{
				id: "p-review",
				label: "Codex · Review",
				profileName: "Review",
				isError: false,
				items: [{ spaceId: "s-2", title: "Audit" }],
			},
		],
	});
	const { result } = renderHook(() =>
		useActiveMemberAgentSessionList(active, noStatus)
	);
	// Remembered for this Profile, though not its latest chat.
	expect(result.current?.sections[0]?.row?.to).toBe("/dm/s-1");
	// Nothing remembered for the other Profile: its latest chat.
	expect(result.current?.sections[1]?.row?.to).toBe("/dm/s-2");
	window.localStorage.clear();
});
