import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AppSettingsDialog from "./app-settings-dialog";

const native = vi.hoisted(() => ({
	pending: true,
	handler: undefined as undefined | ((destination: string) => void),
}));
vi.mock("#/desktop/platform", () => ({
	getDesktopPlatform: () => ({
		onWindowDestinationChange: (handler: (destination: string) => void) => {
			native.handler = handler;
			// The preload has retained an intent received before the workspace loaded.
			if (native.pending) {
				native.pending = false;
				handler("settings");
			}
			return () => {
				native.handler = undefined;
			};
		},
	}),
}));
vi.mock("./settings-page", () => ({
	SettingsPage: () => <h2>Existing account settings</h2>,
}));
afterEach(() => {
	cleanup();
	document.body.inert = false;
	native.pending = true;
});

it("opens the existing dialog from an early native intent without leaving the thread or losing draft state", async () => {
	const root = createRootRoute({ component: Outlet });
	const org = createRoute({
		getParentRoute: () => root,
		path: "/o/$orgSlug",
		component: Outlet,
	});
	const conversation = createRoute({
		getParentRoute: () => org,
		path: "/spaces/$spaceId",
		validateSearch: (search: Record<string, unknown>) => search,
		component: () => (
			<>
				<input data-testid="draft" defaultValue="Unsent draft" />
				<AppSettingsDialog />
			</>
		),
	});
	const history = createMemoryHistory({
		initialEntries: ["/o/team/spaces/space?thread=thread-42"],
	});
	const router = createRouter({
		routeTree: root.addChildren([org.addChildren([conversation])]),
		history,
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByText("Existing account settings");
	expect(history.location.pathname).toBe("/o/team/spaces/space");
	expect(new URLSearchParams(history.location.search).get("thread")).toBe(
		"thread-42"
	);
	expect(new URLSearchParams(history.location.search).get("appSettings")).toBe(
		"account"
	);
	const draft = screen.getByTestId("draft") as HTMLInputElement;
	fireEvent.change(draft, { target: { value: "Still unsent" } });
	await act(async () => {
		history.replace("/o/team/spaces/space?thread=thread-42");
		await router.load();
	});
	expect(screen.queryByText("Existing account settings")).toBeNull();
	const before = history.location.href;
	document.body.inert = true;
	await act(async () => native.handler?.("settings"));
	expect(history.location.href).toBe(before);
	expect(draft.value).toBe("Still unsent");
	document.body.inert = false;
	await act(async () => native.handler?.("settings"));
	await waitFor(() =>
		expect(screen.getByText("Existing account settings")).toBeTruthy()
	);
	expect(screen.getByTestId("draft")).toBe(draft);
	expect(draft.value).toBe("Still unsent");
});
