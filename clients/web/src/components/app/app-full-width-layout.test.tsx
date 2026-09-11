import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFullWidthLayout } from "./app-full-width-layout";

const appOuterRailSpy = vi.hoisted(() => vi.fn());

vi.mock("#/components/app/app-outer-rail", () => ({
	AppOuterRail: (props: { contextualNavigation?: ReactNode }) => {
		appOuterRailSpy(props);
		return (
			<aside data-slot="app-outer-rail">{props.contextualNavigation}</aside>
		);
	},
}));

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "felix@example.com",
		image: null,
		name: "Felix",
	}),
}));

vi.mock("#/components/app/current-computer", () => ({
	CurrentComputerToolbarLauncher: () => null,
	useCurrentComputer: () => null,
}));

afterEach(cleanup);

describe("AppFullWidthLayout", () => {
	it("places profile lists in the middle column without duplicating application navigation", () => {
		render(
			<AppFullWidthLayout
				mainSidebarContent={<nav aria-label="People">Members</nav>}
			>
				<h1>Profile</h1>
			</AppFullWidthLayout>
		);
		const list = screen.getByRole("navigation", { name: "People" });
		expect(list.closest('[data-testid="app-module-sidebar"]')).toBeTruthy();
		expect(
			document.querySelector('[data-slot="app-inline-contextual-navigation"]')
		).toBeTruthy();
	});
	it("renders the outer rail and full-width scroll content without a contextual sidebar", () => {
		const initialOuterSidebarState = {
			tier: "expanded" as const,
			width: "6rem",
		};

		render(
			<AppFullWidthLayout initialOuterSidebarState={initialOuterSidebarState}>
				<h1>Activity</h1>
			</AppFullWidthLayout>
		);

		expect(
			document.querySelector('[data-slot="app-full-width-layout"]')
		).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Activity" })).toBeTruthy();
		expect(
			document.querySelector('[data-slot="app-full-width-content-scroll"]')
		).toBeTruthy();
		expect(
			document.querySelector('[data-slot="app-main-content-header"]')
		).toBeNull();
		const content = document.querySelector(
			'[data-slot="app-full-width-content"]'
		);
		expect(content?.className).toContain("pt-8");
		expect(document.querySelector('nav[aria-label="Organization"]')).toBeNull();
		expect(appOuterRailSpy).toHaveBeenCalled();
		expect(screen.queryByTestId("app-module-sidebar")).toBeNull();
	});

	it("supports a resizable contextual sidebar and flush profile content", () => {
		render(
			<AppFullWidthLayout
				contentLayout="flush"
				mobileSidebarTitle="People"
				showMainHeader
				sidebar={<nav aria-label="People">Human Profiles</nav>}
				sidebarPreferenceKey="people"
			>
				<h1>Felix Lu</h1>
			</AppFullWidthLayout>
		);

		expect(screen.getByRole("navigation", { name: "People" })).toBeTruthy();
		expect(
			document.querySelector('[data-slot="app-full-width-content"]')?.className
		).toContain("min-h-full");
		expect(
			document.querySelector('[data-slot="app-main-content-header"]')
		).toBeTruthy();
	});
});
