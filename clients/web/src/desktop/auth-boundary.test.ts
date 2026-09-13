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
		const bridge = {
			session: async () => ({
				user: signedIn
					? { id: "account-a", email: "a@example.com", name: "A" }
					: null,
			}),
			platform: vi.fn(),
			signIn: vi.fn(),
			signOut: vi.fn(),
		} satisfies DesktopPilotBridge;
		vi.stubGlobal("window", {
			location: { protocol: "openmeld-desktop:", host: "app" },
			openmeldDesktop: bridge,
		});
		const loader = vi.fn();
		const root = createRootRoute({
			beforeLoad: ({ location }) =>
				beforeDesktopLoad(location.pathname, location.href),
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
