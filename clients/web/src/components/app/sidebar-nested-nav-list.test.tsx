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

it("shows each chat's last-message time before its status, older ones on hover", () => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		}
	);
	const today = new Date();
	today.setHours(9, 5, 0, 0);
	const older = new Date(today);
	older.setDate(older.getDate() - 7);
	render(
		<SidebarMenu>
			<SidebarMenuItem>
				<SidebarNestedNavList
					activeItemId={null}
					ariaLabel="Chats with Codex"
					sections={[
						{
							id: "p-default",
							items: [
								{
									id: "s-1",
									label: "Today chat",
									to: "/dm/s-1",
									timestamp: today.getTime(),
									accessory: <span data-testid="s-1-status" />,
								},
								{
									id: "s-2",
									label: "Older chat",
									to: "/dm/s-2",
									timestamp: older.getTime(),
								},
								{ id: "s-3", label: "Empty chat", to: "/dm/s-3" },
							],
						},
					]}
				/>
			</SidebarMenuItem>
		</SidebarMenu>
	);
	const todayRow = screen.getByRole("link", { name: "Today chat" });
	const todayTime = todayRow.querySelector("time");
	expect(todayTime?.textContent).toBe("09:05");
	expect(todayTime?.className).not.toContain("hidden");
	// The time and the status share one trailing slot, time first.
	expect(todayTime?.nextElementSibling).toBe(screen.getByTestId("s-1-status"));
	expect(
		screen.getByRole("link", { name: "Older chat" }).querySelector("time")
			?.className
	).toContain("in-[[data-sidebar=menu-sub-button]:hover]:inline-flex");
	expect(
		screen.getByRole("link", { name: "Empty chat" }).querySelector("time")
	).toBeNull();
});

it("nests each section's chats under its own row, which is always a real row", () => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		}
	);
	const onSelect = vi.fn();
	render(
		<SidebarMenu>
			<SidebarMenuItem>
				<SidebarNestedNavList
					activeItemId="s-2"
					ariaLabel="Chats with Cursor"
					sections={[
						{
							id: "p-default",
							label: "Cursor",
							row: { label: "Cursor", to: "/dm/s-1" },
							items: [{ id: "s-1", label: "Plan", to: "/dm/s-1" }],
						},
						{
							id: "p-moved",
							label: "Cursor · Moved",
							row: { label: "Moved", onSelect },
							items: [],
						},
					]}
				/>
			</SidebarMenuItem>
		</SidebarMenu>
	);
	const nav = screen.getByRole("navigation", { name: "Chats with Cursor" });
	const profile = within(nav).getByRole("link", { name: "Cursor" });
	expect(profile.getAttribute("href")).toBe("/dm/s-1");
	// The chat nests inside its Profile's row, one level deeper.
	expect(
		profile
			.closest('[data-nested-nav-section="p-default"]')
			?.contains(within(nav).getByRole("link", { name: "Plan" }))
	).toBe(true);
	within(nav).getByRole("button", { name: "Moved" }).click();
	expect(onSelect).toHaveBeenCalledOnce();
	// No inert section label is drawn.
	expect(within(nav).queryByText("Cursor · Moved")).toBeNull();
});
