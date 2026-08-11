import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppInnerSidebar, AppInnerSidebarHeader } from "./app-inner-sidebar";

afterEach(() => {
	cleanup();
});

describe("AppInnerSidebar", () => {
	it("shares the main content background surface", () => {
		render(
			<AppInnerSidebar
				preferenceKey="spaces"
				separatorLabel="Resize inner sidebar"
			>
				<div>Sidebar content</div>
			</AppInnerSidebar>
		);

		const sidebar = document.querySelector('[data-slot="sidebar"]');

		expect(sidebar?.className).toContain("bg-background");
		expect(sidebar?.className).not.toContain("bg-sidebar");
	});

	it("lets pointer and keyboard resizing reach the 128px global floor", () => {
		render(
			<AppInnerSidebar
				preferenceKey="spaces"
				separatorLabel="Resize inner sidebar"
			>
				<div>Sidebar content</div>
			</AppInnerSidebar>
		);

		expect(
			screen
				.getByRole("separator", { name: "Resize inner sidebar" })
				.getAttribute("aria-valuemin")
		).toBe("128");
	});

	it("restores the matching width when the page family changes", () => {
		const rendered = render(
			<AppInnerSidebar
				initialState={{ tier: "full", width: "18rem" }}
				preferenceKey="center-agent"
				separatorLabel="Resize inner sidebar"
			>
				<div>Sidebar content</div>
			</AppInnerSidebar>
		);

		expect(
			document
				.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')
				?.style.getPropertyValue("--sidebar-width")
		).toBe("18rem");

		rendered.rerender(
			<AppInnerSidebar
				initialState={{ tier: "full", width: "12rem" }}
				preferenceKey="spaces"
				separatorLabel="Resize inner sidebar"
			>
				<div>Sidebar content</div>
			</AppInnerSidebar>
		);

		expect(
			document
				.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')
				?.style.getPropertyValue("--sidebar-width")
		).toBe("12rem");
	});

	it("uses one compact title without secondary description copy", () => {
		const { container } = render(
			<AppInnerSidebarHeader title="Center Agent" />
		);

		const title = screen.getByRole("heading", {
			level: 2,
			name: "Center Agent",
		});

		expect(title.className).toContain("text-xs");
		expect(container.querySelector("p")).toBeNull();
	});
});
