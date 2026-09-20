import {
	createBrowserHistory,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Link,
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { installClientVersionRecovery } from "#/client-version-recovery";
import { UnsavedChangesGuard } from "./unsaved-changes-guard";

afterEach(cleanup);

describe("UnsavedChangesGuard", () => {
	it("keeps navigation blocked until the user cancels, discards, or saves", async () => {
		const save = vi
			.fn<() => Promise<boolean>>()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const router = renderGuard(save);
		await screen.findByRole("link", { name: "Leave editor" });
		const reload = vi.fn();
		const disposeRecovery = installClientVersionRecovery({
			now: () => 1_000_000,
			reload,
			window,
		});
		try {
			act(() =>
				window.dispatchEvent(
					Object.assign(new Event("vite:preloadError", { cancelable: true }), {
						payload: new Error("Unable to preload CSS for /assets/old.css"),
					})
				)
			);
			expect(reload).not.toHaveBeenCalled();
			expect(router.state.location.pathname).toBe("/editor");
		} finally {
			disposeRecovery();
		}

		fireEvent.click(await screen.findByRole("link", { name: "Leave editor" }));
		expect(
			await screen.findByRole("heading", {
				name: "Save changes before leaving?",
			})
		).toBeTruthy();
		expect(router.state.location.pathname).toBe("/editor");

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() =>
			expect(
				screen.queryByRole("heading", {
					name: "Save changes before leaving?",
				})
			).toBeNull()
		);
		expect(router.state.location.pathname).toBe("/editor");

		fireEvent.click(screen.getByRole("link", { name: "Leave editor" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Save and leave" })
		);
		expect(
			await screen.findByText(
				"OpenMeld couldn't save your changes. Fix the error and try again."
			)
		).toBeTruthy();
		expect(router.state.location.pathname).toBe("/editor");

		fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/privacy")
		);
		expect(save).toHaveBeenCalledTimes(2);
	});

	it.each([
		-2, -1, 1, 2,
	])("restores browser history after canceling traversal by %s entries", async (delta) => {
		const previousUrl = window.location.href;
		const scroll = vi
			.spyOn(window, "scrollTo")
			.mockImplementation(() => undefined);
		window.history.replaceState(null, "", "/privacy?step=-2");
		const history = createBrowserHistory();
		try {
			for (const path of [
				"/privacy?step=-1",
				"/editor",
				"/privacy?step=1",
				"/privacy?step=2",
			]) {
				await act(() => {
					history.push(path);
				});
			}
			await new Promise<void>((resolve) => {
				window.addEventListener("popstate", () => resolve(), { once: true });
				history.go(-2);
			});
			const save = vi.fn<() => Promise<boolean>>();
			const router = renderGuard(save, history);
			await screen.findByRole("link", { name: "Leave editor" });
			act(() => history.go(delta));
			fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
			await waitFor(() => expect(window.location.pathname).toBe("/editor"));
			expect(router.state.location.pathname).toBe("/editor");
			act(() => history.go(delta));
			fireEvent.click(
				await screen.findByRole("button", { name: "Discard changes" })
			);
			await waitFor(() =>
				expect(router.state.location.href).toBe(`/privacy?step=${delta}`)
			);
			expect(window.location.pathname + window.location.search).toBe(
				`/privacy?step=${delta}`
			);
			expect(save).not.toHaveBeenCalled();
		} finally {
			cleanup();
			history.destroy();
			window.history.replaceState(null, "", previousUrl);
			scroll.mockRestore();
		}
	});

	it("discards browser-local changes without calling save", async () => {
		const save = vi.fn<() => Promise<boolean>>();
		const router = renderGuard(save);

		fireEvent.click(await screen.findByRole("link", { name: "Leave editor" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Discard changes" })
		);

		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/privacy")
		);
		expect(save).not.toHaveBeenCalled();
	});
});

function renderGuard(
	save: () => Promise<boolean>,
	history = createMemoryHistory({ initialEntries: ["/editor"] })
) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const editorRoute = createRoute({
		component: () => (
			<>
				<Link to="/privacy">Leave editor</Link>
				<UnsavedChangesGuard
					description="Your changes to this skill haven't been saved."
					hasUnsavedChanges
					onSave={save}
				/>
			</>
		),
		getParentRoute: () => rootRoute,
		path: "/editor",
	});
	const nextRoute = createRoute({
		component: () => <h1>Next page</h1>,
		getParentRoute: () => rootRoute,
		path: "/privacy",
	});
	const router = createRouter({
		history,
		routeTree: rootRoute.addChildren([editorRoute, nextRoute]),
	});
	render(<RouterProvider router={router} />);
	return router;
}
