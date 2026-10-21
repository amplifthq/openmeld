import { QueryClient } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { DesktopPilotBridge } from "../../../desktop/src/shared/pilot-bridge";
import {
	beforeDesktopLoad,
	desktopReturnPath,
	registerDesktopEntryRedirect,
} from "./auth-boundary";

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

	describe("stale-while-revalidate navigation", () => {
		const signedIn = {
			user: { id: "account-a", email: "a@example.com", name: "A" },
		};
		function stubBridge(session: () => Promise<unknown>) {
			const bridge = { session: vi.fn(session) };
			vi.stubGlobal("window", {
				location: { protocol: "openmeld-desktop:", host: "app" },
				openmeldDesktop: bridge,
			});
			return bridge;
		}
		function registerRedirect() {
			const redirectToEntry = vi.fn();
			onTestFinished(registerDesktopEntryRedirect(redirectToEntry));
			return redirectToEntry;
		}
		async function primeAndAge(queryClient: QueryClient) {
			await beforeDesktopLoad("/o/team", "/o/team", queryClient);
			const later = Date.now() + 31_000;
			return vi.spyOn(Date, "now").mockReturnValue(later);
		}

		it("navigates on a stale signed-in session and keeps it when revalidation agrees", async () => {
			const queryClient = new QueryClient();
			const bridge = stubBridge(async () => signedIn);
			const redirectToEntry = registerRedirect();
			const now = await primeAndAge(queryClient);
			try {
				let resolveSession: ((value: unknown) => void) | undefined;
				bridge.session.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							resolveSession = resolve;
						})
				);
				// The navigation resolves while the native session read is pending.
				await expect(
					beforeDesktopLoad("/o/team/spaces/a", "/o/team/spaces/a", queryClient)
				).resolves.toBeUndefined();
				expect(bridge.session).toHaveBeenCalledTimes(2);
				resolveSession?.(signedIn);
				await vi.waitFor(() =>
					expect(
						queryClient.getQueryState(["desktop", "native-session"])
							?.dataUpdatedAt
					).toBe(Date.now())
				);
				expect(redirectToEntry).not.toHaveBeenCalled();
			} finally {
				now.mockRestore();
			}
		});

		it("returns to the Desktop entry when background revalidation is signed out", async () => {
			const queryClient = new QueryClient();
			const bridge = stubBridge(async () => signedIn);
			const redirectToEntry = registerRedirect();
			queryClient.setQueryData(["account", "private"], { secret: true });
			const now = await primeAndAge(queryClient);
			try {
				bridge.session.mockResolvedValueOnce({ user: null });
				await beforeDesktopLoad(
					"/o/team/spaces/a",
					"/o/team/spaces/a?threadId=t",
					queryClient
				);
				await vi.waitFor(() =>
					expect(redirectToEntry).toHaveBeenCalledWith({
						redirect: "/o/team/spaces/a?threadId=t",
					})
				);
				expect(queryClient.getQueryData(["account", "private"])).toBe(
					undefined
				);
				// The next navigation blocks on the native answer and redirects.
				bridge.session.mockResolvedValueOnce({ user: null });
				await expect(
					beforeDesktopLoad("/o/team/spaces/a", "/o/team/spaces/a", queryClient)
				).rejects.toMatchObject({ options: { to: "/desktop-shell" } });
			} finally {
				now.mockRestore();
			}
		});

		it("returns to the Desktop entry when another account is now signed in", async () => {
			const queryClient = new QueryClient();
			const bridge = stubBridge(async () => signedIn);
			const redirectToEntry = registerRedirect();
			const now = await primeAndAge(queryClient);
			try {
				bridge.session.mockResolvedValueOnce({
					user: { id: "account-b", email: "b@example.com", name: "B" },
				});
				await beforeDesktopLoad("/o/team", "/o/team", queryClient);
				await vi.waitFor(() => expect(redirectToEntry).toHaveBeenCalledOnce());
			} finally {
				now.mockRestore();
			}
		});

		it("keeps the page when background revalidation fails", async () => {
			const queryClient = new QueryClient();
			const bridge = stubBridge(async () => signedIn);
			const redirectToEntry = registerRedirect();
			const warn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => undefined);
			const now = await primeAndAge(queryClient);
			try {
				bridge.session.mockRejectedValueOnce(new Error("bridge unavailable"));
				await beforeDesktopLoad("/o/team", "/o/team", queryClient);
				await vi.waitFor(() => expect(warn).toHaveBeenCalled());
				expect(redirectToEntry).not.toHaveBeenCalled();
			} finally {
				now.mockRestore();
				warn.mockRestore();
			}
		});

		it("waits for the native session when none was confirmed", async () => {
			const queryClient = new QueryClient();
			stubBridge(async () => ({ user: null }));
			registerRedirect();
			await expect(
				beforeDesktopLoad("/o/team", "/o/team", queryClient)
			).rejects.toMatchObject({ options: { to: "/desktop-shell" } });
		});
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
