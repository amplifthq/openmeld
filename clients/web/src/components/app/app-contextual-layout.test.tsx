import { MonitorIcon, UserIcon } from "@phosphor-icons/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppContextualSidebarNav } from "./app-contextual-layout";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		activeOptions: _activeOptions,
		children,
		to,
		...props
	}: {
		activeOptions?: unknown;
		children: ReactNode;
		to: string;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

afterEach(() => {
	cleanup();
});

describe("AppContextualSidebarNav", () => {
	it("composes leading actions, label accessories, and dynamic group content inside the shared sidebar frame", () => {
		render(
			<AppContextualSidebarNav
				activeItemId={null}
				ariaLabel="Spaces"
				groups={[
					{
						ariaLabel: "Workspace Spaces",
						content: <p>No spaces yet.</p>,
						id: "spaces",
						label: "Spaces",
						labelAccessory: <span>3</span>,
					},
				]}
				leadingContent={<button type="button">New Space</button>}
				title="Spaces"
			/>
		);

		const sidebar = screen.getByRole("navigation", { name: "Spaces" });
		const content = sidebar.querySelector('[data-slot="sidebar-content"]');
		const groupLabel = screen
			.getByText("3")
			.closest<HTMLElement>('[data-slot="sidebar-group-label"]');

		expect(sidebar.getAttribute("data-slot")).toBe("app-contextual-sidebar");
		expect(content?.className).toContain("px-3");
		expect(
			content?.contains(screen.getByRole("button", { name: "New Space" }))
		).toBe(true);
		expect(groupLabel?.className).toContain("text-sidebar-foreground/55");
		expect(
			screen.getByRole("region", { name: "Workspace Spaces" }).textContent
		).toContain("No spaces yet.");
	});

	it("renders quiet group labels above contextual navigation items", () => {
		render(
			<AppContextualSidebarNav
				activeItemId="overview"
				ariaLabel="Projects"
				groups={[
					{
						ariaLabel: "Project navigation",
						id: "work",
						items: [
							{
								icon: MonitorIcon,
								id: "overview",
								label: "Overview",
								to: "/o/acme/projects",
							},
						],
						label: "Work",
					},
				]}
				title="Projects"
			/>
		);

		const groupLabel = screen.getByRole("heading", {
			level: 2,
			name: "Work",
		});
		const group = groupLabel.closest('[data-slot="sidebar-group"]');

		expect(groupLabel.className).toContain("ps-[5px]");
		expect(groupLabel.className).toContain("pe-2");
		expect(groupLabel.className).not.toContain("px-2");
		expect(groupLabel.className).toContain("text-sidebar-foreground/55");
		expect(group?.className).toContain("gap-2");
		expect(group?.className).toContain("p-0");
		expect(
			screen.getByRole("navigation", { name: "Project navigation" })
		).toBeTruthy();
	});

	it("collapses a labeled group through an accessible disclosure trigger", () => {
		render(
			<AppContextualSidebarNav
				activeItemId="overview"
				ariaLabel="Projects"
				groups={[
					{
						ariaLabel: "Project navigation",
						id: "work",
						items: [
							{
								icon: MonitorIcon,
								id: "overview",
								label: "Overview",
								to: "/o/acme/projects",
							},
						],
						label: "Work",
					},
				]}
				title="Projects"
			/>
		);

		const trigger = screen.getByRole("button", { name: "Work" });
		const caret = trigger.querySelector('[data-slot="sidebar-group-caret"]');

		expect(trigger.className).toContain("inline-flex");
		expect(trigger.className).not.toContain("flex-1");
		expect(trigger.className).toContain("gap-1.5");
		expect(caret).toBe(trigger.lastElementChild);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();

		fireEvent.click(trigger);

		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByRole("link", { name: "Overview" })).toBeNull();
	});

	it("renders warning-status nav items in amber", () => {
		render(
			<AppContextualSidebarNav
				activeItemId="account"
				ariaLabel="Settings"
				groups={[
					{
						ariaLabel: "Settings sections",
						id: "settings",
						items: [
							{
								icon: UserIcon,
								id: "account",
								label: "Account",
								to: "/app/settings/account",
							},
							{
								icon: MonitorIcon,
								id: "computers",
								label: "Computers",
								statusTone: "warning",
								to: "/app/settings/computers",
							},
						],
						label: "Settings",
					},
				]}
				title="Settings"
			/>
		);

		expect(
			screen.getByRole("link", { name: "Computers" }).firstElementChild
				?.className
		).toContain("text-amber-300");
	});

	it("renders danger-status nav items in destructive red", () => {
		render(
			<AppContextualSidebarNav
				activeItemId="account"
				ariaLabel="Settings"
				groups={[
					{
						ariaLabel: "Settings sections",
						id: "settings",
						items: [
							{
								icon: UserIcon,
								id: "account",
								label: "Account",
								to: "/app/settings/account",
							},
							{
								icon: MonitorIcon,
								id: "computers",
								label: "Computers",
								statusTone: "danger",
								to: "/app/settings/computers",
							},
						],
						label: "Settings",
					},
				]}
				title="Settings"
			/>
		);

		expect(
			screen.getByRole("link", { name: "Computers" }).firstElementChild
				?.className
		).toContain("text-destructive");
	});

	it("activates nav items that stay on the current route", () => {
		const handleActivate = vi.fn();

		render(
			<AppContextualSidebarNav
				activeItemId="overview"
				ariaLabel="Center Agent"
				groups={[
					{
						ariaLabel: "Center Agent sections",
						id: "work",
						items: [
							{
								icon: UserIcon,
								id: "overview",
								label: "Overview",
							},
							{
								icon: MonitorIcon,
								id: "activity",
								label: "Activity",
							},
						],
						label: "Work",
					},
				]}
				onActivate={handleActivate}
				title="Center Agent"
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Activity" }));

		expect(handleActivate).toHaveBeenCalledWith("activity");
	});

	it("keeps one complete label while adapting it to the sidebar width", () => {
		render(
			<AppContextualSidebarNav
				activeItemId="settings"
				ariaLabel="Center Agent"
				groups={[
					{
						ariaLabel: "Center Agent management",
						id: "manage",
						items: [
							{
								icon: MonitorIcon,
								id: "settings",
								label: "Center Agent settings",
								to: "/o/acme/center-agent/settings",
							},
						],
						label: "Manage",
					},
				]}
				title="Center Agent"
			/>
		);

		const sidebar = screen.getByRole("navigation", { name: "Center Agent" });
		const link = screen.getByRole("link", {
			name: "Center Agent settings",
		});
		const centeredLabel = link.querySelector(
			'[data-slot="center-truncated-text"]'
		);

		expect(sidebar.className).toContain("@container/contextual-sidebar");
		expect(
			Array.from(centeredLabel?.children ?? [])
				.map((element) => element.textContent)
				.join("")
		).toBe("Center Agent settings");
		expect(screen.queryByText("Settings")).toBeNull();
	});

	it("uses the same compact item scale as the full outer app rail", () => {
		render(
			<AppContextualSidebarNav
				activeItemId="account"
				ariaLabel="Settings"
				groups={[
					{
						ariaLabel: "Settings sections",
						id: "settings",
						items: [
							{
								icon: UserIcon,
								id: "account",
								label: "Account",
								to: "/app/settings/account",
							},
						],
						label: "Settings",
					},
				]}
				title="Settings"
			/>
		);

		const item = screen.getByRole("link", {
			name: "Account",
		}).firstElementChild;
		const content = screen
			.getByRole("navigation", { name: "Settings" })
			.querySelector('[data-slot="sidebar-content"]');

		expect(item?.className).toContain("h-7");
		expect(item?.className).toContain("px-1");
		expect(item?.className).toContain("text-[13px]");
		expect(item?.className).toContain("font-medium");
		expect(item?.className).not.toContain("min-h-10");
		expect(item?.className).not.toContain("px-2");
		expect(item?.className).not.toContain("text-sm");
		expect(content?.className).toContain("pt-[9px]");
		expect(content?.className).toContain("pb-2");
		expect(content?.className).not.toContain("py-2");
		expect(content?.className).not.toContain("py-3");
	});
});
