import { QueryClient } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopPilotBridge } from "../../../desktop/src/shared/pilot-bridge";
import { beforeDesktopLoad, desktopReturnPath } from "./auth-boundary";

afterEach(() => vi.unstubAllGlobals());

describe("Desktop route authentication", () => {
	it.each([
		false,
		true,
	])("runs protected child loaders only with a native session: %s", async (signedIn) => {
		const queryClient = new QueryClient();
		const bridge = {
			updaterState: vi.fn(),
			updaterAction: vi.fn(),
			updaterPrepared: vi.fn(),
			onUpdaterChanged: vi.fn(() => () => undefined),
			onUpdaterPrepare: vi.fn(() => () => undefined),
			session: vi.fn(async () => ({
				user: signedIn
					? { id: "account-a", email: "a@example.com", name: "A" }
					: null,
			})),
			platform: vi.fn(),
			showNotification: vi.fn(),
			setNotificationContext: vi.fn(),
			testNotification: vi.fn(),
			notificationFocused: vi.fn(),
			onNotificationPoll: vi.fn(() => () => undefined),
			onNotificationClick: vi.fn(() => () => undefined),
			localComputer: vi.fn(),
			signIn: vi.fn(),
			signOut: vi.fn(),
			connectComputer: vi.fn(),
			disconnectComputer: vi.fn(),
			connectionProgressCurrent: vi.fn(() => Promise.resolve(null)),
			connectionOperationCurrent: vi.fn(() => Promise.resolve(null)),
			onConnectionProgress: vi.fn(() => () => undefined),
			onConnectionOperation: vi.fn(() => () => undefined),
			onSessionChanged: vi.fn(() => () => undefined),
			onWindowDestinationChange: vi.fn(() => () => undefined),
			onNavigationRequest: vi.fn(() => () => undefined),
			openExternal: vi.fn(() => Promise.resolve()),
			spaceStreamOpen: vi.fn(),
			spaceStreamClose: vi.fn(),
			spaceStreamPing: vi.fn(),
			onSpaceStream: vi.fn(() => () => undefined),
		} satisfies DesktopPilotBridge;
		vi.stubGlobal("window", {
			location: { protocol: "openmeld-desktop:", host: "app" },
			openmeldDesktop: bridge,
		});
		const loader = vi.fn();
		const root = createRootRoute({
			beforeLoad: ({ location }) =>
				beforeDesktopLoad(location.pathname, location.href, queryClient),
		});
		const protectedRoute = createRoute({
			getParentRoute: () => root,
			path: "/o/team/spaces/space-a",
			loader,
		});
		const entry = createRoute({
			getParentRoute: () => root,
			path: "/desktop-shell",
		});
		const router = createRouter({
			routeTree: root.addChildren([protectedRoute, entry]),
			history: createMemoryHistory({
				initialEntries: ["/o/team/spaces/space-a"],
			}),
			isServer: true,
		});
		await router.load();
		expect(loader).toHaveBeenCalledTimes(signedIn ? 1 : 0);
		if (signedIn) {
			await beforeDesktopLoad(
				"/o/team/spaces/space-a",
				"/o/team/spaces/space-a",
				queryClient
			);
			expect(bridge.session).toHaveBeenCalledTimes(1);
			const later = Date.now() + 31_000;
			const now = vi.spyOn(Date, "now").mockReturnValue(later);
			try {
				await beforeDesktopLoad(
					"/o/team/spaces/space-a",
					"/o/team/spaces/space-a",
					queryClient
				);
				expect(bridge.session).toHaveBeenCalledTimes(2);
			} finally {
				now.mockRestore();
			}
		}
		if (!signedIn) {
			await expect(
				beforeDesktopLoad("/o/team/spaces/space-a", "/o/team/spaces/space-a")
			).rejects.toMatchObject({
				options: {
					to: "/desktop-shell",
					search: { redirect: "/o/team/spaces/space-a" },
				},
			});
		}
	});

	it.each([
		"https://example.com",
		"//example.com/o/team",
		"/o/../login",
		"/o/\\example.com",
		"/login",
		undefined,
	])("rejects non-workspace return path %s", (value) => {
		expect(desktopReturnPath(value)).toBeUndefined();
	});

	it("preserves the Space thread and settings destination", () => {
		expect(
			desktopReturnPath(
				"/o/team/spaces/a?threadId=b&appSettings=appearance#message"
			)
		).toBe("/o/team/spaces/a?threadId=b&appSettings=appearance#message");
	});
});
