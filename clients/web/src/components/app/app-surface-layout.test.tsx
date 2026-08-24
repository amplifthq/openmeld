import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppSurfaceLayout } from "./app-surface-layout";

afterEach(cleanup);

describe("AppSurfaceLayout", () => {
	it("keeps the outer rail on the app canvas and groups contextual navigation with content inside one inset surface", () => {
		render(
			<AppSurfaceLayout
				globalControls={<div data-slot="test-global-controls" />}
				outerRail={<aside data-slot="test-outer-rail" />}
				sidebar={<aside data-slot="test-inner-sidebar" />}
			>
				<main data-slot="test-main-content" />
			</AppSurfaceLayout>
		);

		const frame = document.querySelector('[data-slot="app-surface-layout"]');
		const surface = document.querySelector('[data-slot="app-surface"]');
		const inlineNavigation = document.querySelector(
			'[data-slot="app-inline-navigation"]'
		);
		const outerRail = document.querySelector('[data-slot="test-outer-rail"]');
		const innerSidebar = document.querySelector(
			'[data-slot="test-inner-sidebar"]'
		);
		const mainContent = document.querySelector(
			'[data-slot="test-main-content"]'
		);
		const globalControls = document.querySelector(
			'[data-slot="test-global-controls"]'
		);

		expect(frame).toBeTruthy();
		expect(surface).toBeTruthy();
		expect(frame?.children[0]).toBe(inlineNavigation);
		expect(inlineNavigation?.contains(outerRail)).toBe(true);
		expect(frame?.children[1]).toBe(surface);
		expect(surface?.contains(outerRail)).toBe(false);
		expect(surface?.contains(innerSidebar)).toBe(true);
		expect(surface?.contains(mainContent)).toBe(true);
		expect(frame?.contains(globalControls)).toBe(true);
		expect(surface?.contains(globalControls)).toBe(false);
		expect(surface?.className).toContain("lg:mt-2");
		expect(surface?.className).toContain("lg:mr-2");
		expect(surface?.className).toContain("lg:mb-9");
		expect(surface?.className).not.toContain("m-2");
		expect(surface?.className).not.toContain("ml-2");
		expect(surface?.className).not.toContain("my-2");
		expect(surface?.className).toContain("min-w-0");
		expect(surface?.className).toContain("overflow-hidden");
		expect(surface?.className).toContain("lg:border-[0.5px]");
	});

	it("supports full-width app routes without inventing an empty inner sidebar", () => {
		render(
			<AppSurfaceLayout
				ariaBusy
				frameSlotName="test-full-width-layout"
				globalControls={<div data-slot="test-global-controls" />}
				outerRail={<aside data-slot="test-outer-rail" />}
			>
				<main data-slot="test-main-content" />
			</AppSurfaceLayout>
		);

		const frame = document.querySelector(
			'[data-slot="test-full-width-layout"]'
		);
		const surface = document.querySelector('[data-slot="app-surface"]');
		const surfaceBody = document.querySelector(
			'[data-slot="app-surface-body"]'
		);

		expect(frame?.getAttribute("aria-busy")).toBe("true");
		expect(surface?.children).toHaveLength(2);
		expect(surfaceBody?.children).toHaveLength(1);
		expect(surfaceBody?.firstElementChild?.getAttribute("data-slot")).toBe(
			"test-main-content"
		);
	});

	it("keeps primary navigation reachable from the narrow app header", () => {
		render(
			<AppSurfaceLayout
				globalControls={<div data-slot="test-global-controls" />}
				mobileSidebarTitle="Spaces"
				outerRail={<nav aria-label="Primary test navigation" />}
				sidebar={<nav aria-label="Spaces test navigation" />}
			>
				<main data-slot="test-main-content" />
			</AppSurfaceLayout>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Open app navigation" })
		);
		const primaryDrawer = screen.getByRole("dialog", {
			name: "App navigation",
		});
		expect(
			within(primaryDrawer).getByRole("navigation", {
				name: "Primary test navigation",
			})
		).toBeTruthy();
	});

	it("keeps contextual navigation reachable from the narrow app header", () => {
		render(
			<AppSurfaceLayout
				globalControls={<div data-slot="test-global-controls" />}
				mobileSidebarTitle="Spaces"
				outerRail={<nav aria-label="Primary test navigation" />}
				sidebar={<nav aria-label="Spaces test navigation" />}
			>
				<main data-slot="test-main-content" />
			</AppSurfaceLayout>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Open Spaces navigation" })
		);
		const contextualDrawer = screen.getByRole("dialog", {
			name: "Spaces navigation",
		});
		expect(
			within(contextualDrawer).getByRole("navigation", {
				name: "Spaces test navigation",
			})
		).toBeTruthy();
	});

	it("returns focus to the app navigation trigger after Escape closes its drawer", async () => {
		render(
			<AppSurfaceLayout
				globalControls={<div data-slot="test-global-controls" />}
				outerRail={<nav aria-label="Primary test navigation" />}
			>
				<main data-slot="test-main-content" />
			</AppSurfaceLayout>
		);

		const trigger = screen.getByRole("button", {
			name: "Open app navigation",
		});
		trigger.focus();
		fireEvent.click(trigger);
		expect(screen.getByRole("dialog", { name: "App navigation" })).toBeTruthy();

		fireEvent.keyDown(document, { key: "Escape" });

		await waitFor(() => {
			expect(document.activeElement).toBe(trigger);
		});
	});
});
