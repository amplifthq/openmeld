import { SparkleIcon } from "@phosphor-icons/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceHeaderNavigationMenu } from "./space-header-navigation-menu";

const navigateSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateSpy,
}));

afterEach(() => {
	cleanup();
	navigateSpy.mockClear();
});

describe("SpaceHeaderNavigationMenu", () => {
	it("opens a preserved destination from the compact menu", async () => {
		render(
			<SpaceHeaderNavigationMenu
				ariaLabel="Center Agent menu"
				items={[
					{
						icon: SparkleIcon,
						label: "Skills",
						to: "/o/acme/center-agent/skills",
					},
				]}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Center Agent menu" }));
		const menuItem = await screen.findByRole("menuitem", { name: "Skills" });
		const menu = screen.getByRole("menu");
		expect(
			menu.querySelector('[data-slot="fluid-action-list"]')
		).not.toBeNull();
		fireEvent.click(menuItem);

		expect(navigateSpy).toHaveBeenCalledWith({
			to: "/o/acme/center-agent/skills",
		});
	});

	it("keeps conversation information inside the same menu", async () => {
		const onOpenConversationInformation = vi.fn();
		render(
			<SpaceHeaderNavigationMenu
				ariaLabel="Center Agent menu"
				items={[]}
				onOpenConversationInformation={onOpenConversationInformation}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Center Agent menu" }));
		const conversationInformation = await screen.findByRole("menuitem", {
			name: "Chat settings",
		});
		expect(screen.queryByRole("separator")).toBeNull();
		fireEvent.click(conversationInformation);

		expect(onOpenConversationInformation).toHaveBeenCalledTimes(1);
	});
});
