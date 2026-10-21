import { QueryClient } from "@tanstack/react-query";
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
	createEvent,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppNavigationPresentationProvider } from "./app-navigation-presentation";
import { AppRailLink } from "./app-rail-navigation";

beforeEach(() => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

async function renderNavigation(input: {
	initialHref: string;
	destination?: string;
}) {
	const dismiss = vi.fn();
	const readOrganizationContext = vi.fn(() =>
		Promise.resolve({ accountId: "account-a" })
	);
	const queryClient = new QueryClient();
	const root = createRootRoute({
		component: () => (
			<AppNavigationPresentationProvider
				dismiss={dismiss}
				presentation="drawer"
			>
				<ul>
					<AppRailLink
						active
						destination={{
							id: "spaces",
							label: "Spaces",
							icon: null,
							to: input.destination ?? "/o/acme/spaces",
						}}
						tier="expanded"
					/>
				</ul>
				<Outlet />
			</AppNavigationPresentationProvider>
		),
	});
	const welcome = createRoute({
		getParentRoute: () => root,
		path: "/welcome",
		component: () => <p>Welcome page</p>,
	});
	const organization = createRoute({
		getParentRoute: () => root,
		path: "/o/$orgSlug",
		loader: () =>
			queryClient.fetchQuery({
				queryKey: ["account-organization-context"],
				queryFn: readOrganizationContext,
				staleTime: 0,
				retry: false,
			}),
		errorComponent: () => <p>Organization unavailable</p>,
	});
	const spaces = createRoute({
		getParentRoute: () => organization,
		path: "spaces",
		validateSearch: (search) => search,
		component: () => <p>Spaces page</p>,
	});
	const thread = createRoute({
		getParentRoute: () => organization,
		path: "spaces/$threadId",
		component: () => <p>Thread page</p>,
	});
	const history = createMemoryHistory({ initialEntries: [input.initialHref] });
	const router = createRouter({
		routeTree: root.addChildren([
			welcome,
			organization.addChildren([spaces, thread]),
		]),
		history,
		defaultPendingMinMs: 0,
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return { dismiss, history, queryClient, readOrganizationContext, router };
}

describe("AppRailLink", () => {
	it.each([
		"/o/acme/spaces",
		"/o/acme/spaces?view=messages#archived",
	])("loads %s once and dismisses repeated current-page clicks without reauthenticating", async (destination) => {
		const { dismiss, history, queryClient, readOrganizationContext, router } =
			await renderNavigation({ initialHref: "/welcome", destination });
		expect(readOrganizationContext).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("link", { name: "Spaces" }));
		await screen.findByText("Spaces page");
		await waitFor(() => expect(router.state.isLoading).toBe(false));
		expect(readOrganizationContext).toHaveBeenCalledTimes(1);
		expect(dismiss).toHaveBeenCalledTimes(1);

		readOrganizationContext.mockRejectedValue(
			new Error("Session read timed out")
		);
		const historyLength = history.length;
		await act(() => {
			fireEvent.click(screen.getByRole("link", { name: "Spaces" }));
			fireEvent.click(screen.getByRole("link", { name: "Spaces" }), {
				detail: 0,
			});
		});
		expect(readOrganizationContext).toHaveBeenCalledTimes(1);
		expect(screen.getByText("Spaces page")).toBeTruthy();
		expect(screen.queryByText("Organization unavailable")).toBeNull();
		expect(history.length).toBe(historyLength);
		expect(dismiss).toHaveBeenCalledTimes(3);
		queryClient.clear();
	});

	it.each([
		"/o/acme/spaces/thread-a",
		"/o/acme/spaces?view=messages",
		"/o/acme/spaces#archived",
	])("navigates from %s even when the destination is selected", async (initialHref) => {
		const { history, queryClient, router } = await renderNavigation({
			initialHref,
		});
		fireEvent.click(screen.getByRole("link", { name: "Spaces" }));
		await waitFor(() => expect(history.location.href).toBe("/o/acme/spaces"));
		await waitFor(() => expect(router.state.isLoading).toBe(false));
		expect(screen.getByText("Spaces page")).toBeTruthy();
		queryClient.clear();
	});

	it.each([
		{ ctrlKey: true },
		{ metaKey: true },
		{ shiftKey: true },
		{ altKey: true },
		{ button: 1 },
		{ target: "_blank" },
	])("preserves native alternate navigation for %j", async ({
		target,
		...init
	}) => {
		const { dismiss, queryClient } = await renderNavigation({
			initialHref: "/o/acme/spaces",
		});
		const link = screen.getByRole("link", { name: "Spaces" });
		if (target) {
			link.setAttribute("target", target);
		}
		const event = createEvent.click(link, init);
		let wasPrevented: boolean | undefined;
		document.addEventListener(
			"click",
			(browserEvent) => {
				wasPrevented = browserEvent.defaultPrevented;
				browserEvent.preventDefault();
			},
			{ once: true }
		);
		fireEvent(link, event);
		expect(wasPrevented).toBe(false);
		expect(dismiss).not.toHaveBeenCalled();
		queryClient.clear();
	});
});
