import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterAgentHeaderTabs } from "./center-agent-header-navigation";

const navigateSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const preloadSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const route = vi.hoisted(() => ({ searchStr: "" }));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateSpy,
	useRouter: () => ({ preloadRoute: preloadSpy }),
	useRouterState: ({
		select,
	}: {
		select: (state: { location: { searchStr: string } }) => unknown;
	}) => select({ location: route }),
}));

afterEach(() => {
	cleanup();
	navigateSpy.mockClear();
	preloadSpy.mockClear();
	route.searchStr = "";
});

describe("CenterAgentHeaderTabs", () => {
	it("keeps the draft when switching work views", () => {
		route.searchStr = "?draft=new";
		render(
			<CenterAgentHeaderTabs
				activeSectionId="chat"
				idPrefix="draft-navigation"
				organizationSlug="acme"
			/>
		);
		fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
		expect(navigateSpy).toHaveBeenLastCalledWith({
			to: "/o/acme/chats/center-agent?draft=new&view=tasks",
		});
		fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
		expect(navigateSpy).toHaveBeenLastCalledWith({
			to: "/o/acme/chats/center-agent?draft=new",
		});
	});
	it("keeps primary work in the requested header order", () => {
		render(
			<CenterAgentHeaderTabs
				activeSectionId="chat"
				idPrefix="center-agent-test"
				organizationSlug="acme"
			/>
		);

		expect(screen.getAllByRole("tab")).toEqual([
			screen.getByRole("tab", { name: "Messages" }),
			screen.getByRole("tab", { name: "Tasks" }),
			screen.getByRole("tab", { name: "Graph" }),
			screen.getByRole("tab", { name: "Files" }),
		]);
		expect(
			screen
				.getByRole("tab", { name: "Messages" })
				.getAttribute("aria-selected")
		).toBe("true");
		expect(screen.queryByRole("tab", { name: "Skills" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "Routines" })).toBeNull();
	});

	it("opens the requested conversation view", () => {
		render(
			<CenterAgentHeaderTabs
				activeSectionId="chat"
				idPrefix="center-agent-test"
				organizationSlug="acme"
			/>
		);

		fireEvent.click(screen.getByRole("tab", { name: "Files" }));

		expect(navigateSpy).toHaveBeenCalledWith({
			to: "/o/acme/chats/center-agent?view=files",
		});

		fireEvent.click(screen.getByRole("tab", { name: "Messages" }));

		expect(navigateSpy).toHaveBeenLastCalledWith({
			to: "/o/acme/chats/center-agent",
		});
	});
});
