import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentProfile } from "#/test-support/member-agent-fixtures";
import {
	filterMemberAgentSessionSections,
	MemberAgentPageSidebar,
} from "./member-agent-page-sidebar";

const { sessionList } = vi.hoisted(() => ({ sessionList: vi.fn() }));
vi.mock("./member-agent-session-nav", () => ({
	useMemberAgentPageSessionList: sessionList,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to: string;
		"aria-label"?: string;
	}) => (
		<a aria-label={props["aria-label"]} href={to}>
			{children}
		</a>
	),
}));
vi.mock("#/components/app/app-navigation-presentation", () => ({
	useAppNavigationPresentation: () => ({
		dismiss: vi.fn(),
		presentation: "desktop",
	}),
}));
vi.mock("#/components/app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: null,
		disabled: true,
		save: vi.fn(),
	}),
}));

afterEach(cleanup);

const CHATS_WITH_PATTERN = /chats with/;

const DEFAULT = agentProfile("p-default", "Claude Code");
const REVIEWER = agentProfile("p-review", "PR Reviewer");

function sections() {
	return [
		{
			id: "p-default",
			items: [{ id: "s-1", label: "Plan the release", to: "/dm/s-1" }],
		},
		{
			id: "p-review",
			items: [{ id: "s-2", label: "Audit", to: "/dm/s-2" }],
		},
	];
}

describe("MemberAgentPageSidebar", () => {
	it("lists a single Profile's chats without a Profile row or chevron", () => {
		sessionList.mockReturnValue(sections().slice(0, 1));
		render(
			<MemberAgentPageSidebar
				activeProfileId="p-default"
				defaultProfileId="p-default"
				displayName="Felix’s Claude Code"
				memberAgentId="ma-1"
				onSelectProfile={vi.fn()}
				profiles={[DEFAULT]}
			/>
		);
		expect(screen.getByRole("link", { name: "Plan the release" })).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: CHATS_WITH_PATTERN })
		).toBeNull();
		expect(screen.queryByText("Felix’s Claude Code · PR Reviewer")).toBeNull();
		expect(screen.getByRole("tab", { name: "Active" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Archived" })).toBeTruthy();
	});

	it("makes each Profile a row with its chats nested and a fold chevron", () => {
		sessionList.mockReturnValue(sections());
		const onSelectProfile = vi.fn();
		render(
			<MemberAgentPageSidebar
				activeProfileId="p-default"
				defaultProfileId="p-default"
				displayName="Felix’s Claude Code"
				memberAgentId="ma-1"
				onSelectProfile={onSelectProfile}
				profiles={[DEFAULT, REVIEWER]}
			/>
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Felix’s Claude Code · PR Reviewer" })
		);
		expect(onSelectProfile).toHaveBeenCalledWith("p-review");
		expect(
			screen.getByRole("navigation", {
				name: "Chats with Felix’s Claude Code · PR Reviewer",
			})
		).toBeTruthy();
		const fold = screen.getByRole("button", {
			name: "Hide chats with Felix’s Claude Code · PR Reviewer",
		});
		expect(fold.getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(fold);
		expect(
			screen
				.getByRole("button", {
					name: "Show chats with Felix’s Claude Code · PR Reviewer",
				})
				.getAttribute("aria-expanded")
		).toBe("false");
		expect(onSelectProfile).toHaveBeenCalledTimes(1);
	});

	it("reads archived chats from the Archived tab", () => {
		sessionList.mockReturnValue([]);
		render(
			<MemberAgentPageSidebar
				activeProfileId={null}
				defaultProfileId="p-default"
				displayName="Felix’s Claude Code"
				memberAgentId="ma-1"
				onSelectProfile={vi.fn()}
				profiles={[DEFAULT]}
			/>
		);
		expect(screen.getByText("No chats yet.")).toBeTruthy();
		fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
		expect(sessionList).toHaveBeenLastCalledWith({
			memberAgentId: "ma-1",
			archived: true,
		});
		expect(screen.getByText("No archived chats.")).toBeTruthy();
	});
});

it("filters chats by title and keeps every Profile section", () => {
	expect(
		filterMemberAgentSessionSections(sections(), "audit").map((section) =>
			section.items.map((item) => item.id)
		)
	).toEqual([[], ["s-2"]]);
});
