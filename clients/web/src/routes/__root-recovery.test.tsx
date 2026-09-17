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
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopPilotBridge } from "../../../desktop/src/shared/pilot-bridge";
import { RootErrorComponent } from "./__root";

afterEach(() => {
	cleanup();
});

it("retries the current native route after a session read fails, without navigating or admitting an unavailable session", async () => {
	const user = { id: "account-a", email: "a@example.com", name: "A" };
	let failure: string | null = "desktop:session fetch failed";
	const session = vi.fn<DesktopPilotBridge["session"]>(() => {
		if (failure) {
			return Promise.reject(new Error(failure));
		}
		return Promise.resolve({ user });
	});
	const loader = vi.fn();
	const root = createRootRoute({
		beforeLoad: async () => {
			await session();
		},
		errorComponent: RootErrorComponent,
	});
	const people = createRoute({
		getParentRoute: () => root,
		path: "/o/team/people",
		loader: () => loader(),
		component: () => <p>Team page loaded</p>,
	});
	const destination = "/o/team/people?view=members#current";
	const history = createMemoryHistory({ initialEntries: [destination] });
	const router = createRouter({
		routeTree: root.addChildren([people]),
		history,
		defaultPendingMinMs: 0,
	});
	await router.load();
	render(<RouterProvider router={router} />);
	expect(await screen.findByText("desktop:session fetch failed")).toBeTruthy();
	expect(loader).not.toHaveBeenCalled();

	failure = "desktop:session still unavailable";
	fireEvent.click(screen.getByRole("button", { name: "Refresh page" }));
	expect(await screen.findByText(failure)).toBeTruthy();
	expect(loader).not.toHaveBeenCalled();
	expect(history.location.href).toBe(destination);

	failure = null;
	const attempts = session.mock.calls.length;
	fireEvent.click(screen.getByRole("button", { name: "Refresh page" }));
	expect(await screen.findByText("Team page loaded")).toBeTruthy();
	await waitFor(() => expect(router.state.isLoading).toBe(false));
	expect(loader).toHaveBeenCalledTimes(1);
	expect(session).toHaveBeenCalledTimes(attempts + 1);
	expect(history.location.href).toBe(destination);
	expect(history.length).toBe(1);
	expect(screen.queryByText("This page couldn’t load.")).toBeNull();
});
