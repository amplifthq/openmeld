import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	RootErrorComponent,
	RootNotFoundComponent,
	Route,
	ThemeColorMeta,
} from "./__root";

const useNavigateMock = vi.hoisted(() => vi.fn());
const themeState = vi.hoisted(() => ({
	resolvedTheme: "dark" as string | undefined,
}));
const OLD_HEADER_TAB_NAMES = [
	"New Space",
	"Spaces",
	"Agents",
	"Account",
] as const;

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
			<a href={to} {...props}>
				{children}
			</a>
		),
		useNavigate: () => useNavigateMock,
		useRouterState: (input: {
			select: (state: { location: { pathname: string } }) => string;
		}) => input.select({ location: { pathname: "/" } }),
	};
});

vi.mock("next-themes", async (importOriginal) => {
	const actual = await importOriginal<typeof import("next-themes")>();
	return {
		...actual,
		useTheme: () => themeState,
	};
});

vi.mock("#/components/openmeld-logo-weak", () => ({
	OpenMeldLogo: () => <div aria-label="OpenMeld logo" role="img" />,
}));

describe("RootErrorComponent", () => {
	afterEach(() => {
		cleanup();
		useNavigateMock.mockReset();
	});

	it("uses the public landing header on application errors", () => {
		render(
			<RootErrorComponent
				error={new Error("resolveServiceAction is not defined")}
				info={{ componentStack: "" }}
				reset={vi.fn()}
			/>
		);

		const publicHeader = readPublicLandingHeader();
		expect(publicHeader.banner).toBeTruthy();
		expect(publicHeader.homeHref).toBe("/");
		expect(publicHeader.appEntryHref).toBe("/login");
		for (const oldTab of publicHeader.oldTabs) {
			expect(oldTab).toBeNull();
		}
		expect(screen.getByText("Application Error")).toBeTruthy();
		expect(
			screen.getByText("resolveServiceAction is not defined")
		).toBeTruthy();
	});

	it("explains a stale deployed asset without exposing its internal URL", () => {
		const failedAssetUrl =
			"https://openmeld.ai/assets/highlighted-body-old-build.js";
		render(
			<RootErrorComponent
				error={
					new Error(
						`Failed to fetch dynamically imported module: ${failedAssetUrl}`
					)
				}
				info={{ componentStack: "" }}
				reset={vi.fn()}
			/>
		);

		expect(
			screen.getByText("OpenMeld was updated while this page was open.")
		).toBeTruthy();
		expect(
			screen.getByText("Refresh to load the latest version.")
		).toBeTruthy();
		expect(screen.queryByText(new RegExp(failedAssetUrl))).toBeNull();
	});

	it("uses the public landing header on not-found errors", () => {
		render(<RootNotFoundComponent />);

		const publicHeader = readPublicLandingHeader();
		expect(publicHeader.banner).toBeTruthy();
		expect(publicHeader.homeHref).toBe("/");
		expect(publicHeader.appEntryHref).toBe("/login");
		for (const oldTab of publicHeader.oldTabs) {
			expect(oldTab).toBeNull();
		}
		expect(screen.getByText("404")).toBeTruthy();
		expect(screen.getByText("This page does not exist.")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Back to home" }).getAttribute("href")
		).toBe("/");
	});
});

describe("root document response", () => {
	it("requires browsers to revalidate HTML before reusing asset references", async () => {
		const headers = await Route.options.headers?.({} as never);

		expect(headers).toEqual({
			"Cache-Control": "no-cache",
		});
	});
});

describe("ThemeColorMeta", () => {
	afterEach(() => {
		cleanup();
		document.head.querySelector('meta[name="theme-color"]')?.remove();
		themeState.resolvedTheme = "dark";
	});

	it.each([
		["light", "#ffffff"],
		["dark", "#111110"],
	] as const)("uses the %s background color", (resolvedTheme, expectedColor) => {
		const meta = document.createElement("meta");
		meta.name = "theme-color";
		meta.content = "#000000";
		document.head.appendChild(meta);
		themeState.resolvedTheme = resolvedTheme;

		render(<ThemeColorMeta />);

		expect(meta.content).toBe(expectedColor);
	});
});

function readPublicLandingHeader() {
	return {
		banner: screen.getByRole("banner"),
		homeHref: screen
			.getByRole("link", { name: "Go to OpenMeld homepage" })
			.getAttribute("href"),
		appEntryHref: screen
			.getByRole("link", { name: "Login" })
			.getAttribute("href"),
		oldTabs: OLD_HEADER_TAB_NAMES.map((label) =>
			screen.queryByRole("tab", { name: label })
		),
	};
}
