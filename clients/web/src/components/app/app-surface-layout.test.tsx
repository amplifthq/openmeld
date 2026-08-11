import { cleanup, render } from "@testing-library/react";
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
		expect(frame?.children[0]).toBe(outerRail);
		expect(frame?.children[1]).toBe(surface);
		expect(surface?.contains(outerRail)).toBe(false);
		expect(surface?.contains(innerSidebar)).toBe(true);
		expect(surface?.contains(mainContent)).toBe(true);
		expect(frame?.contains(globalControls)).toBe(true);
		expect(surface?.contains(globalControls)).toBe(false);
		expect(surface?.className).toContain("mt-2");
		expect(surface?.className).toContain("mr-2");
		expect(surface?.className).toContain("mb-9");
		expect(surface?.className).not.toContain("m-2");
		expect(surface?.className).not.toContain("ml-2");
		expect(surface?.className).not.toContain("my-2");
		expect(surface?.className).toContain("min-w-0");
		expect(surface?.className).toContain("overflow-hidden");
		expect(surface?.className).toContain("border-[0.5px]");
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

		expect(frame?.getAttribute("aria-busy")).toBe("true");
		expect(surface?.children).toHaveLength(1);
		expect(surface?.firstElementChild?.getAttribute("data-slot")).toBe(
			"test-main-content"
		);
	});
});
