import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentProfile } from "#/test-support/member-agent-fixtures";
import { MemberAgentPageSidebar } from "./member-agent-page-sidebar";

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
				harnessKind="claude-code"
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
				harnessKind="claude-code"
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
				harnessKind="claude-code"
				memberAgentId="ma-1"
				onSelectProfile={vi.fn()}
				profiles={[DEFAULT]}
			/>
		);
		expect(screen.getByText("No chats yet.")).toBeTruthy();
		fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
		expect(sessionList).toHaveBeenLastCalledWith({
			memberAgentId: "ma-1",
			colleagueAgent: null,
			archived: true,
		});
		expect(screen.getByText("No archived chats.")).toBeTruthy();
	});

	it("has no chat search; global search finds chats", () => {
		sessionList.mockReturnValue(sections().slice(0, 1));
		render(
			<MemberAgentPageSidebar
				activeProfileId={null}
				defaultProfileId="p-default"
				displayName="Felix’s Claude Code"
				harnessKind="claude-code"
				memberAgentId="ma-1"
				onSelectProfile={vi.fn()}
				profiles={[DEFAULT]}
			/>
		);
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("lists the viewer's own chats with a colleague's Agent by its Profiles", () => {
		sessionList.mockReturnValue([{ id: "p-default", items: [] }]);
		render(
			<MemberAgentPageSidebar
				activeProfileId="p-default"
				defaultProfileId="p-default"
				displayName="Tali’s Claude Code"
				emptyAction={<button type="button">Ask to use</button>}
				harnessKind="claude-code"
				memberAgentId={null}
				onSelectProfile={vi.fn()}
				profiles={[DEFAULT]}
			/>
		);
		expect(sessionList).toHaveBeenLastCalledWith({
			memberAgentId: null,
			colleagueAgent: {
				harnessKind: "claude-code",
				displayName: "Tali’s Claude Code",
				defaultProfileId: "p-default",
				profiles: [DEFAULT],
			},
			archived: false,
		});
		expect(screen.getByRole("button", { name: "Ask to use" })).toBeTruthy();
		expect(screen.queryByText("No chats yet.")).toBeNull();
		fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
		expect(screen.queryByRole("button", { name: "Ask to use" })).toBeNull();
		expect(screen.getByText("No archived chats.")).toBeTruthy();
	});
});
