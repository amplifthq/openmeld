import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import type { SpaceStatusSources } from "#/components/spaces/space-status-indicators";
import { useActiveMemberAgentSessionNav } from "./member-agent-session-nav";

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
vi.mock("@tanstack/react-router", () => ({
	Link: (props: { to: string; children: ReactNode; "aria-label": string }) => (
		<a aria-label={props["aria-label"]} href={props.to}>
			{props.children}
		</a>
	),
}));
vi.mock("@openmeld/ui/components/tooltip", () => ({
	TooltipHint: (props: { children: ReactNode }) => props.children,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({ currentOrganization: { slug: "acme" } }),
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
	const { result } = renderHook(() =>
		useActiveMemberAgentSessionNav(active, noStatus)
	);
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
	// The first group links back to the MemberAgent's page.
	render(<div>{result.current[0]?.labelAccessory}</div>);
	expect(
		screen.getByRole("link", { name: "Open Codex" }).getAttribute("href")
	).toBe("/o/acme/agents?memberAgentId=ma-1");
});

it("adds nothing outside a MemberAgent Session", () => {
	sessionGroups.mockReturnValue({ sessionPath: String, groups: [] });
	const { result } = renderHook(() =>
		useActiveMemberAgentSessionNav(undefined, noStatus)
	);
	expect(result.current).toEqual([]);
});

it("shows each Session's own status so other Sessions are not missed", () => {
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
	const active = {
		kind: "direct-message",
		spaceId: "s-idle",
		memberAgentId: "ma-1",
		chat: { peer: { profileId: "p-default" } },
	} as unknown as Conversation;
	const { result } = renderHook(() =>
		useActiveMemberAgentSessionNav(active, {
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
	const items = result.current[0]?.items ?? [];
	expect(items.map((item) => item.ariaLabel)).toEqual([
		undefined,
		"Unread, unread updates",
		"Approval, Priority attention, Codex needs your input",
	]);
	const { container } = render(
		<div>
			{items.map((item) => (
				<span data-session={item.id} key={item.id}>
					{item.accessory}
				</span>
			))}
		</div>
	);
	const marks = (spaceId: string) =>
		[
			...container.querySelectorAll(
				`[data-session="${spaceId}"] [data-space-status]`
			),
		].map((element) => element.getAttribute("data-space-status"));
	expect(marks("s-idle")).toEqual([]);
	expect(marks("s-unread")).toEqual(["unread"]);
	expect(marks("s-approval")).toEqual(["attention", "active"]);
});
