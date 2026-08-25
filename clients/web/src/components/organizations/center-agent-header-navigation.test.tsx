import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildCenterAgentHeaderMenuItems,
	CenterAgentHeaderTabs,
} from "./center-agent-header-navigation";

const navigateSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateSpy,
}));

afterEach(() => {
	cleanup();
	navigateSpy.mockClear();
});

describe("CenterAgentHeaderTabs", () => {
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
			screen.getByRole("tab", { name: "Tasks" }),
			screen.getByRole("tab", { name: "Routines" }),
			screen.getByRole("tab", { name: "Skills" }),
			screen.getByRole("tab", { name: "Apps" }),
		]);
	});

	it("opens Tasks, Routines, Skills, and Apps from the header", () => {
		render(
			<CenterAgentHeaderTabs
				activeSectionId="chat"
				idPrefix="center-agent-test"
				organizationSlug="acme"
			/>
		);

		fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
		fireEvent.click(screen.getByRole("tab", { name: "Routines" }));
		fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
		fireEvent.click(screen.getByRole("tab", { name: "Apps" }));

		expect(navigateSpy).toHaveBeenNthCalledWith(1, {
			to: "/o/acme/center-agent/tasks",
		});
		expect(navigateSpy).toHaveBeenNthCalledWith(2, {
			to: "/o/acme/center-agent/routines",
		});
		expect(navigateSpy).toHaveBeenNthCalledWith(3, {
			to: "/o/acme/center-agent/skills",
		});
		expect(navigateSpy).toHaveBeenNthCalledWith(4, {
			to: "/o/acme/center-agent/apps",
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
			to: "/o/acme/center-agent/chat?view=files",
		});

		fireEvent.click(screen.getByRole("tab", { name: "Messages" }));

		expect(navigateSpy).toHaveBeenLastCalledWith({
			to: "/o/acme/center-agent/chat",
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
			["Channels", "/o/acme/center-agent/channels"],
			["Memory", "/o/acme/center-agent/memory"],
			["Center Agent settings", "/o/acme/center-agent/settings"],
		]);
	});
});
