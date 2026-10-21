import { lazyRouteComponent } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { type ReactNode, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CLIENT_VERSION_RECOVERY_ATTEMPT_KEY,
	CLIENT_VERSION_RECOVERY_NAVIGATION_TIMEOUT_MS,
	installClientVersionRecovery,
	resetClientVersionRecovery,
} from "../client-version-recovery";
import {
	ClientVersionRecovery,
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
		useRouter: () => ({ invalidate: vi.fn() }),
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
		expect(screen.getByText("This page couldn’t load.")).toBeTruthy();
		expect(
			screen.getByText("resolveServiceAction is not defined")
		).toBeTruthy();
	});

	it("explains an unavailable page asset without claiming a deployment or exposing its URL", () => {
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
			screen.getByText("Some files needed for this page couldn’t load.")
		).toBeTruthy();
		expect(screen.getByText("Refresh the page to try again.")).toBeTruthy();
		expect(screen.queryByText(new RegExp(failedAssetUrl))).toBeNull();
	});

	it("includes the timed-out request ID in the copyable error details", () => {
		render(
			<RootErrorComponent
				error={Object.assign(new Error("Account context timed out"), {
					code: "network.timeout",
					requestId: "req-account-context",
				})}
				info={{ componentStack: "" }}
				reset={vi.fn()}
			/>
		);
		expect(document.querySelector("details pre")?.textContent).toContain(
			"Request ID: req-account-context"
		);
	});

	it.each([
		"timeout",
		"navigation",
	])("shows loading during automatic refresh and leaves recovery on %s", (exit) => {
		const error = new Error(
			"Failed to fetch dynamically imported module: /assets/old.js"
		);
		const reload = vi.fn();
		window.sessionStorage.clear();
		vi.useFakeTimers();
		const dispose = installClientVersionRecovery({
			now: () => 1_000_000,
			reload,
			window,
		});
		try {
			render(
				<ClientVersionRecovery>
					<p>Current page</p>
				</ClientVersionRecovery>
			);
			act(() =>
				window.dispatchEvent(
					Object.assign(new Event("vite:preloadError", { cancelable: true }), {
						payload: error,
					})
				)
			);
			expect(screen.queryByText("This page couldn’t load.")).toBeNull();
			expect(
				screen.getByRole("status", { name: "Updating this page" })
			).toBeTruthy();
			expect(reload).toHaveBeenCalledOnce();
			if (exit === "navigation") {
				act(resetClientVersionRecovery);
			}
			act(() =>
				vi.advanceTimersByTime(CLIENT_VERSION_RECOVERY_NAVIGATION_TIMEOUT_MS)
			);
			if (exit === "timeout") {
				expect(screen.getByText("This page couldn’t load.")).toBeTruthy();
				expect(
					screen.getByRole("button", { name: "Refresh page" })
				).toBeTruthy();
			} else {
				expect(screen.getByText("Current page")).toBeTruthy();
				expect(screen.queryByText("This page couldn’t load.")).toBeNull();
			}
			expect(
				screen.queryByRole("status", { name: "Updating this page" })
			).toBeNull();
			expect(reload).toHaveBeenCalledOnce();
		} finally {
			cleanup();
			dispose();
			window.sessionStorage.clear();
			vi.useRealTimers();
		}
	});

	it.each([
		false,
		true,
	])("takes over a failed lazy route before its native reload path (already attempted: %s)", async (alreadyAttempted) => {
		window.sessionStorage.clear();
		if (alreadyAttempted) {
			window.sessionStorage.setItem(
				CLIENT_VERSION_RECOVERY_ATTEMPT_KEY,
				"1000000"
			);
		}
		const reload = vi.fn();
		const dispose = installClientVersionRecovery({
			now: () => 1_000_001,
			reload,
			window,
		});
		const failedImport = new Error(
			"Failed to fetch dynamically imported module: /assets/route-old.js"
		);
		const LazyPage = lazyRouteComponent(
			async (): Promise<{ default: () => ReactNode }> => {
				await Promise.resolve();
				// Vite's documented event precedes rejection of the same import.
				window.dispatchEvent(
					Object.assign(new Event("vite:preloadError", { cancelable: true }), {
						payload: failedImport,
					})
				);
				throw failedImport;
			}
		);
		try {
			const view = render(
				<ClientVersionRecovery>
					<p>Current page</p>
				</ClientVersionRecovery>
			);
			await act(() => LazyPage.preload?.());
			view.rerender(
				<ClientVersionRecovery>
					<Suspense fallback={<p>Route loading</p>}>
						<LazyPage />
					</Suspense>
				</ClientVersionRecovery>
			);
			expect(screen.queryByText("Route loading")).toBeNull();
			if (alreadyAttempted) {
				expect(reload).not.toHaveBeenCalled();
				expect(
					screen.getByRole("button", { name: "Refresh page" })
				).toBeTruthy();
			} else {
				expect(reload).toHaveBeenCalledOnce();
				expect(
					screen.getByRole("status", { name: "Updating this page" })
				).toBeTruthy();
				expect(screen.queryByText("This page couldn’t load.")).toBeNull();
			}
		} finally {
			cleanup();
			dispose();
			window.sessionStorage.clear();
		}
	});

	it.each([
		"getItem",
		"setItem",
		"reload",
	] as const)("shows a usable failure when recovery cannot %s", (operation) => {
		window.sessionStorage.clear();
		const reload = vi.fn(() => {
			if (operation === "reload") {
				throw new Error("Navigation unavailable");
			}
		});
		const storageSpy =
			operation === "reload"
				? undefined
				: vi.spyOn(Storage.prototype, operation).mockImplementation(() => {
						throw new Error("Storage unavailable");
					});
		const dispose = installClientVersionRecovery({
			now: () => 1_000_000,
			reload,
			window,
		});
		try {
			render(
				<ClientVersionRecovery>
					<p>Current page</p>
				</ClientVersionRecovery>
			);
			act(() =>
				window.dispatchEvent(
					Object.assign(new Event("vite:preloadError", { cancelable: true }), {
						payload: new Error("Unable to preload CSS for /assets/old.css"),
					})
				)
			);
			expect(screen.getByRole("button", { name: "Refresh page" })).toBeTruthy();
			expect(
				screen.queryByRole("status", { name: "Updating this page" })
			).toBeNull();
			expect(reload).toHaveBeenCalledTimes(operation === "reload" ? 1 : 0);
		} finally {
			cleanup();
			dispose();
			storageSpy?.mockRestore();
			window.sessionStorage.clear();
		}
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
			.getByRole("link", { name: "Log in" })
			.getAttribute("href"),
		oldTabs: OLD_HEADER_TAB_NAMES.map((label) =>
			screen.queryByRole("tab", { name: label })
		),
	};
}
