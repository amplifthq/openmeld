import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildCenterAgentHeaderMenuItems,
	CenterAgentHeaderTabs,
} from "./center-agent-header-navigation";

const navigateSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const route = vi.hoisted(() => ({ searchStr: "" }));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateSpy,
	useRouterState: ({
		select,
	}: {
		select: (state: { location: { searchStr: string } }) => unknown;
	}) => select({ location: route }),
}));

afterEach(() => {
	cleanup();
	navigateSpy.mockClear();
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
		fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
		expect(navigateSpy).toHaveBeenLastCalledWith({
			to: "/o/acme/center-agent/skills?draft=new",
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
				activeSpaceView="messages"
				idPrefix="center-agent-test"
				onSpaceViewChange={() => undefined}
				organizationSlug="acme"
			/>
		);

		expect(screen.getAllByRole("tab")).toEqual([
			screen.getByRole("tab", { name: "Messages" }),
			screen.getByRole("tab", { name: "Graph" }),
			screen.getByRole("tab", { name: "Files" }),
			screen.getByRole("tab", { name: "Routines" }),
			screen.getByRole("tab", { name: "Skills" }),
			screen.getByRole("tab", { name: "Plugins" }),
			screen.getByRole("tab", { name: "Channels" }),
		]);
	});

	it("opens Routines, Skills, and Plugins from the header", () => {
		render(
			<CenterAgentHeaderTabs
				activeSectionId="chat"
				idPrefix="center-agent-test"
				organizationSlug="acme"
			/>
		);

		fireEvent.click(screen.getByRole("tab", { name: "Routines" }));
		fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
		fireEvent.click(screen.getByRole("tab", { name: "Plugins" }));
		fireEvent.click(screen.getByRole("tab", { name: "Channels" }));

		expect(navigateSpy).toHaveBeenNthCalledWith(1, {
			to: "/o/acme/center-agent/routines",
		});
		expect(navigateSpy).toHaveBeenNthCalledWith(2, {
			to: "/o/acme/center-agent/skills",
		});
		expect(navigateSpy).toHaveBeenNthCalledWith(3, {
			to: "/o/acme/center-agent/plugins",
		});
		expect(navigateSpy).toHaveBeenNthCalledWith(4, {
			to: "/o/acme/center-agent/channels",
		});
	});

	it("returns from a management page to the requested conversation view", () => {
		render(
			<CenterAgentHeaderTabs
				activeSectionId="skills"
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

describe("buildCenterAgentHeaderMenuItems", () => {
	it("keeps lower-frequency destinations in the compact menu", () => {
		expect(
			buildCenterAgentHeaderMenuItems("acme").map((item) => [
				item.label,
				item.to,
			])
		).toEqual([
			["Memory", "/o/acme/center-agent/memory"],
			["Center Agent settings", "/o/acme/center-agent/settings"],
		]);
	});
});
