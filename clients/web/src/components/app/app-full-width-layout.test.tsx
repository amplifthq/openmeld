import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFullWidthLayout } from "./app-full-width-layout";

const appOuterRailSpy = vi.hoisted(() => vi.fn());

vi.mock("#/components/app/app-outer-rail", () => ({
	AppOuterRail: (props: unknown) => {
		appOuterRailSpy(props);
		return <aside data-slot="app-outer-rail" />;
	},
}));

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "felix@example.com",
		image: null,
		name: "Felix",
	}),
}));

vi.mock("#/components/app/use-settings-attention-tone", () => ({
	useSettingsAttentionTone: () => null,
}));

afterEach(cleanup);

describe("AppFullWidthLayout", () => {
	it("renders the outer rail and full-width scroll content without a contextual sidebar", () => {
		const initialOuterSidebarState = {
			tier: "compact" as const,
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
		expect(appOuterRailSpy).toHaveBeenCalledWith(
			expect.objectContaining({ initialState: initialOuterSidebarState })
		);
	});
});
