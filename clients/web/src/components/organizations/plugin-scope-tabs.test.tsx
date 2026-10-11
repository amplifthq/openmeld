import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { NuqsAdapter } from "nuqs/adapters/tanstack-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as PluginsRoute } from "#/routes/o/$orgSlug/plugins";
import { PluginScopeTabs, usePluginScope } from "./plugin-scope-tabs";

beforeEach(() => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("Plugin scope navigation", () => {
	it.each([
		"/o/acme/plugins",
		"/o/acme/plugins/cloudflare_worker",
	])("switches ownership without changing the route or dropping a setup request at %s", async (path) => {
		const root = createRootRoute({
			component: () => (
				<NuqsAdapter>
					<Outlet />
				</NuqsAdapter>
			),
		});
		const org = createRoute({
			getParentRoute: () => root,
			path: "/o/$orgSlug",
		});
		const plugins = createRoute({
			getParentRoute: () => org,
			path: "plugins",
			validateSearch: PluginsRoute.options.validateSearch,
			component: () => <Outlet />,
		});
		const index = createRoute({
			getParentRoute: () => plugins,
			path: "/",
			component: ScopePage,
		});
		const detail = createRoute({
			getParentRoute: () => plugins,
			path: "$service",
			component: ScopePage,
		});
		const router = createRouter({
			history: createMemoryHistory({
				initialEntries: [`${path}?scope=organization&request=setup-1`],
			}),
			routeTree: root.addChildren([
				org.addChildren([plugins.addChildren([index, detail])]),
			]),
		});
		await router.load();
		render(<RouterProvider router={router} />);
		fireEvent.click(await screen.findByRole("tab", { name: "Personal" }));
		await waitFor(() => {
			expect(screen.getByRole("status").textContent).toBe("personal");
			expect(router.state.location.pathname).toBe(path);
			expect(router.state.location.search).toEqual({
				scope: "personal",
				request: "setup-1",
			});
		});
		fireEvent.click(screen.getByRole("tab", { name: "Acme" }));
		await waitFor(() =>
			expect(screen.getByRole("status").textContent).toBe("organization")
		);
		router.history.back();
		await waitFor(() =>
			expect(screen.getByRole("status").textContent).toBe("personal")
		);
	});
});

function ScopePage() {
	const scope = usePluginScope();
	return (
		<>
			<PluginScopeTabs isPersonalWorkspace={false} organizationName="Acme" />
			<output>{scope}</output>
		</>
	);
}
