import { SidebarMenu, SidebarMenuItem } from "@openmeld/ui/fluid/sidebar-menu";
import { cleanup, render, screen, within } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SidebarNestedNavList } from "./sidebar-nested-nav-list";

vi.mock("@tanstack/react-router", () => ({
	Link: forwardRef<
		HTMLAnchorElement,
		{ to: string; children: ReactNode; resetScroll?: boolean }
	>(({ to, resetScroll: _resetScroll, ...props }, ref) => (
		<a {...props} href={to} ref={ref} />
	)),
}));
vi.mock("./app-navigation-presentation", () => ({
	useAppNavigationPresentation: () => ({ dismiss: vi.fn() }),
}));

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("nests chats under the parent row with their status and the open one current", () => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		}
	);
	render(
		<SidebarMenu>
			<SidebarMenuItem>
				<span>Claude Code</span>
				<SidebarNestedNavList
					activeItemId="s-2"
					ariaLabel="Chats with Claude Code"
					sections={[
						{
							id: "p-default",
							label: "Claude Code",
							items: [
								{ id: "s-1", label: "Plan", to: "/dm/s-1" },
								{
									id: "s-2",
									label: "Fix free shipping",
									to: "/dm/s-2",
									accessory: <span data-testid="s-2-status" />,
									ariaLabel: "Fix free shipping, Codex needs your input",
								},
							],
						},
					]}
				/>
			</SidebarMenuItem>
		</SidebarMenu>
	);
	const nav = screen.getByRole("navigation", {
		name: "Chats with Claude Code",
	});
	// One section: its label would only repeat the parent row.
	expect(within(nav).queryByText("Claude Code")).toBeNull();
	const current = within(nav).getByRole("link", {
		name: "Fix free shipping, Codex needs your input",
	});
	expect(current.getAttribute("aria-current")).toBe("page");
	expect(current.getAttribute("href")).toBe("/dm/s-2");
	expect(
		current
			.closest('[data-sidebar="menu-sub-item"]')
			?.contains(screen.getByTestId("s-2-status"))
	).toBe(true);
	expect(
		within(nav).getByRole("link", { name: "Plan" }).getAttribute("aria-current")
	).toBeNull();
});
