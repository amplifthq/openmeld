import type { DesktopSession } from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beforeDesktopLoad, desktopReturnPath } from "./auth-boundary";
import { DesktopEntry } from "./desktop-entry";

const bridge = vi.hoisted(() => ({
	session: vi.fn<() => Promise<DesktopSession>>(),
	signIn: vi.fn(),
	signOut: vi.fn(),
	onSessionChanged: vi.fn(() => () => undefined),
}));
vi.mock("./platform", () => ({ getDesktopPlatform: () => bridge }));

afterEach(cleanup);

describe("Desktop entry Router recovery", () => {
	it("returns a failed protected load to entry and retries the exact safe destination once", async () => {
		bridge.session
			.mockRejectedValueOnce(new Error("offline"))
			.mockRejectedValueOnce(new Error("still offline"))
			.mockResolvedValue({
				user: { id: "account-a", email: "a@example.com", name: "A" },
			});
		const client = new QueryClient();
		client.setQueryData(["private-data"], "preserved");
		const root = createRootRoute({
			beforeLoad: ({ location }) =>
				beforeDesktopLoad(location.pathname, location.href, client),
		});
		const entry = createRoute({
			getParentRoute: () => root,
			path: "/desktop-shell",
			validateSearch: (search: Record<string, unknown>) => ({
				redirect: desktopReturnPath(search.redirect),
			}),
			component: DesktopEntry,
		});
		const loader = vi.fn(() => "Original thread");
		const target = createRoute({
			getParentRoute: () => root,
			path: "/o/acme/spaces/a",
			validateSearch: (search: Record<string, unknown>) => ({
				threadId: String(search.threadId),
			}),
			loader,
			component: () => <div>Original thread</div>,
		});
		const destination = "/o/acme/spaces/a?threadId=thread-1#message-2";
		const router = createRouter({
			routeTree: root.addChildren([entry, target]),
			history: createMemoryHistory({ initialEntries: [destination] }),
		});
		render(
			<QueryClientProvider client={client}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		);
		const retry = await screen.findByRole("button", { name: "Retry" });
		expect(router.state.location.pathname).toBe("/desktop-shell");
		expect(loader).not.toHaveBeenCalled();
		fireEvent.click(retry);
		fireEvent.click(retry);
		await screen.findByText("Original thread");
		await waitFor(() => expect(router.state.location.href).toBe(destination));
		expect(loader).toHaveBeenCalledTimes(1);
		expect(bridge.signIn).not.toHaveBeenCalled();
		expect(bridge.signOut).not.toHaveBeenCalled();
		expect(client.getQueryData(["private-data"])).toBe("preserved");
		client.clear();
	});
});
