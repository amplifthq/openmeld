import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
	openExternal: vi.fn(() => Promise.resolve()),
	platform: vi.fn(() =>
		Promise.resolve({ webOrigin: "http://lane.localhost:31952" })
	),
}));
vi.mock("./platform", async (importOriginal) => ({
	...(await importOriginal<typeof import("./platform")>()),
	getDesktopPlatform: () => bridge,
}));

import { DesktopAwareLink } from "./desktop-aware-link";

describe("DesktopAwareLink", () => {
	beforeEach(() => bridge.openExternal.mockClear());

	it("keeps a trusted app link in Router and sends external and modifier clicks to one browser handoff", async () => {
		const root = createRootRoute({ component: Outlet });
		const source = createRoute({
			getParentRoute: () => root,
			path: "/o/team/source",
			component: () => (
				<>
					<DesktopAwareLink href="http://lane.localhost:31952/o/team/agents?profileId=agent-1#activity">
						Agent
					</DesktopAwareLink>
					<DesktopAwareLink href="https://example.com/docs">
						Docs
					</DesktopAwareLink>
					<DesktopAwareLink href="/spaces/space-1">
						Public Space
					</DesktopAwareLink>
				</>
			),
		});
		const target = createRoute({
			getParentRoute: () => root,
			path: "/o/team/agents",
			validateSearch: (search: Record<string, unknown>) => ({
				profileId: String(search.profileId ?? ""),
			}),
			component: () => <h1>Agent page</h1>,
		});
		const history = createMemoryHistory({ initialEntries: ["/o/team/source"] });
		const router = createRouter({
			history,
			routeTree: root.addChildren([source, target]),
		});
		render(<RouterProvider router={router} />);

		fireEvent.click(await screen.findByRole("link", { name: "Docs" }));
		await waitFor(() =>
			expect(bridge.openExternal).toHaveBeenCalledWith(
				"https://example.com/docs"
			)
		);
		expect(bridge.openExternal).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("link", { name: "Public Space" }));
		await waitFor(() => expect(bridge.openExternal).toHaveBeenCalledTimes(2));
		expect(bridge.openExternal).toHaveBeenLastCalledWith(
			"http://lane.localhost:31952/spaces/space-1"
		);

		fireEvent.click(screen.getByRole("link", { name: "Agent" }), {
			metaKey: true,
		});
		await waitFor(() => expect(bridge.openExternal).toHaveBeenCalledTimes(3));
		expect(bridge.openExternal).toHaveBeenLastCalledWith(
			"http://lane.localhost:31952/o/team/agents?profileId=agent-1#activity"
		);
		fireEvent(
			screen.getByRole("link", { name: "Agent" }),
			new MouseEvent("auxclick", { bubbles: true, button: 1 })
		);
		await waitFor(() => expect(bridge.openExternal).toHaveBeenCalledTimes(4));
		expect(bridge.openExternal).toHaveBeenLastCalledWith(
			"http://lane.localhost:31952/o/team/agents?profileId=agent-1#activity"
		);

		fireEvent.click(screen.getByRole("link", { name: "Agent" }));
		await screen.findByRole("heading", { name: "Agent page" });
		expect(router.state.location.search).toEqual({ profileId: "agent-1" });
		expect(router.state.location.hash).toBe("activity");
		expect(bridge.openExternal).toHaveBeenCalledTimes(4);
	});

	it("keeps same-page hash and query navigation on the current app path", async () => {
		const root = createRootRoute({ component: Outlet });
		const source = createRoute({
			getParentRoute: () => root,
			path: "/o/team/source",
			validateSearch: (search: Record<string, unknown>) => ({
				view: String(search.view ?? ""),
			}),
			component: () => (
				<>
					<DesktopAwareLink href="#details">Details</DesktopAwareLink>
					<DesktopAwareLink href="?view=queue">Queue</DesktopAwareLink>
				</>
			),
		});
		const history = createMemoryHistory({
			initialEntries: ["/o/team/source?view=active#top"],
		});
		const router = createRouter({
			history,
			routeTree: root.addChildren([source]),
		});
		render(<RouterProvider router={router} />);

		fireEvent.click(await screen.findByRole("link", { name: "Details" }));
		await waitFor(() => expect(router.state.location.hash).toBe("details"));
		expect(router.state.location.pathname).toBe("/o/team/source");
		expect(router.state.location.search).toEqual({ view: "active" });

		fireEvent.click(screen.getByRole("link", { name: "Queue" }));
		await waitFor(() =>
			expect(router.state.location.search).toEqual({ view: "queue" })
		);
		expect(router.state.location.pathname).toBe("/o/team/source");
		expect(bridge.openExternal).not.toHaveBeenCalled();
	});
});
