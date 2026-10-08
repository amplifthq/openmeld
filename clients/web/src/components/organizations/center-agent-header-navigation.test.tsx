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
	it("keeps the draft when visiting management tabs and returning", () => {
		route.searchStr = "?draft=new";
		render(
			<CenterAgentHeaderTabs
				activeSectionId="chat"
				idPrefix="draft-navigation"
				organizationSlug="acme"
			/>
		);
		fireEvent.focus(screen.getByRole("tab", { name: "Channels" }));
		expect(preloadSpy).toHaveBeenLastCalledWith({
			to: "/o/acme/center-agent/channels?draft=new",
		});
		expect(navigateSpy).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("tab", { name: "Channels" }));
		expect(navigateSpy).toHaveBeenLastCalledWith({
			to: "/o/acme/center-agent/channels?draft=new",
		});
		fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
		expect(navigateSpy).toHaveBeenLastCalledWith({
			to: "/o/acme/chats/center-agent?draft=new",
		});
	});
	it("keeps primary work in the requested header order", () => {
		render(
			<CenterAgentHeaderTabs
				activeSectionId="memory"
				idPrefix="center-agent-test"
				organizationSlug="acme"
			/>
		);

		expect(screen.getAllByRole("tab")).toEqual([
			screen.getByRole("tab", { name: "Messages" }),
			screen.getByRole("tab", { name: "Graph" }),
			screen.getByRole("tab", { name: "Files" }),
			screen.getByRole("tab", { name: "Channels" }),
			screen.getByRole("tab", { name: "Memory" }),
		]);
		expect(
			screen.getByRole("tab", { name: "Memory" }).getAttribute("aria-selected")
		).toBe("true");
		expect(screen.queryByRole("tab", { name: "Skills" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "Routines" })).toBeNull();
	});

	it("opens each Center Agent management tab", () => {
		render(
			<CenterAgentHeaderTabs
				activeSectionId="chat"
				idPrefix="center-agent-test"
				organizationSlug="acme"
			/>
		);

		fireEvent.click(screen.getByRole("tab", { name: "Channels" }));
		fireEvent.click(screen.getByRole("tab", { name: "Memory" }));

		expect(navigateSpy).toHaveBeenNthCalledWith(1, {
			to: "/o/acme/center-agent/channels",
		});
		expect(navigateSpy).toHaveBeenNthCalledWith(2, {
			to: "/o/acme/center-agent/memory",
		});
	});

	it("returns from a management page to the requested conversation view", () => {
		render(
			<CenterAgentHeaderTabs
				activeSectionId="channels"
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
