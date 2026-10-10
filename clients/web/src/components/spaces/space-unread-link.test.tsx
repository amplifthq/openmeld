import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { SpaceUnreadLink } from "./space-unread-link";

const { readTargets } = vi.hoisted(() => ({ readTargets: vi.fn() }));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({ currentOrganization: { id: "org" } }),
}));
vi.mock("#/lib/organizations/inbox", async (original) => ({
	...(await original<typeof import("#/lib/organizations/inbox")>()),
	getCurrentSpaceInboxUnreadTargets: readTargets,
}));
const unread = {
	organizationId: "org",
	spaceId: "space",
	totalUnreadCount: 1,
	hasMoreTargets: false,
	targets: [
		{
			itemId: "item",
			signalId: "reply",
			threadRootSignalId: "root",
			occurredAtMs: 1,
		},
	],
};
beforeEach(() => {
	readTargets.mockReset().mockResolvedValue(unread);
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

async function setup(
	cached = false,
	summary: { count: number; messageUnreadCount?: number } = { count: 1 }
) {
	const client = new QueryClient();
	const otherPath: string = "/other";
	if (cached) {
		client.setQueryData(
			inboxQueryKeys.spaceUnreadTargets("org", "space"),
			unread
		);
	}
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<SpaceUnreadLink
					{...summary}
					spaceId="space"
					url="/space?profileId=human"
					variant="badge"
				/>
				<Link to={otherPath}>Other conversation</Link>
				<Outlet />
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: root.addChildren(
			["/", "/space", "/other"].map((path) =>
				createRoute({
					getParentRoute: () => root,
					path,
					validateSearch: (search: Record<string, unknown>) => search,
				})
			)
		),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return {
		router,
		client,
		dot: await screen.findByRole("link", {
			name:
				summary.messageUnreadCount === 0
					? "New Space. Open to view"
					: `${summary.messageUnreadCount ?? summary.count} unread update. Jump to first unread`,
		}),
	};
}

it.each([
	{ count: 1, messageUnreadCount: 0, label: "New" },
	{ count: 2, messageUnreadCount: 1, label: "1 unread" },
])("presents membership separately from messages: $label", async ({
	count,
	messageUnreadCount,
	label,
}) => {
	readTargets.mockResolvedValue({
		...unread,
		targets: [],
		totalUnreadCount: 0,
	});
	const { router, client, dot } = await setup(false, {
		count,
		messageUnreadCount,
	});
	expect(dot.textContent).toBe(label);
	fireEvent.click(dot);
	await waitFor(() => expect(router.state.location.pathname).toBe("/space"));
	expect(router.state.location.search).toEqual({ profileId: "human" });
	client.clear();
});

it("uses fresh canonical unread data immediately and retains the reply's thread destination", async () => {
	const { router, client, dot } = await setup(true);
	fireEvent.click(dot);
	await waitFor(() => expect(router.state.location.pathname).toBe("/space"));
	expect(router.state.location.search).toMatchObject({
		profileId: "human",
		focusSignalId: "reply",
		focusThreadRootSignalId: "root",
	});
	expect(readTargets).not.toHaveBeenCalled();
	client.clear();
});

it("reuses pointer-intent loading instead of forcing another request when clicked", async () => {
	const { router, client, dot } = await setup();
	fireEvent.pointerEnter(dot);
	await waitFor(() =>
		expect(
			client.getQueryData(inboxQueryKeys.spaceUnreadTargets("org", "space"))
		).toEqual(unread)
	);
	fireEvent.click(dot);
	await waitFor(() => expect(router.state.location.pathname).toBe("/space"));
	expect(readTargets).toHaveBeenCalledTimes(1);
	client.clear();
});

it("does not pull the user back after they leave while an unread lookup is pending", async () => {
	let finish!: (value: typeof unread) => void;
	readTargets.mockReturnValue(
		new Promise<typeof unread>((resolve) => {
			finish = resolve;
		})
	);
	const { router, client, dot } = await setup();
	fireEvent.click(dot);
	await waitFor(() => expect(readTargets).toHaveBeenCalledTimes(1));
	fireEvent.click(screen.getByRole("link", { name: "Other conversation" }));
	await waitFor(() => expect(router.state.location.pathname).toBe("/other"));
	await act(async () => {
		finish(unread);
		await Promise.resolve();
	});
	expect(router.state.location.pathname).toBe("/other");
	client.clear();
});
