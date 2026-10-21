import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
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
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureSpace } from "#/test-support/conversation-sidebar-fixture";
import { ConversationSidebarRow } from "./conversation-sidebar-row";

beforeEach(() => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it.each<[string, string, Record<string, string>]>([
	["spaces/planning?profileId=human", "planning", { profileId: "human" }],
	["chats/direct?profileId=human", "direct", { profileId: "human" }],
	[
		"chats/center-agent?session=session-one",
		"center-agent",
		{ session: "session-one" },
	],
])("preloads %s without navigating and opens it through its avatar", async (target, spaceId, search) => {
	const loader = vi.fn();
	const url = `/o/team/${target}`;
	const client = new QueryClient();
	const root = createRootRoute();
	const index = createRoute({
		getParentRoute: () => root,
		path: "/",
		component: () => (
			<QueryClientProvider client={client}>
				<TooltipProvider>
					<FluidNavMenu activeValue={null}>
						<ConversationSidebarRow
							archived={false}
							attentionTone={null}
							conversation={{
								kind: "space",
								item: fixtureSpace(spaceId, "Planning"),
								spaceId,
								title: "Planning",
								activity: 0,
								url,
								profileId: "human",
							}}
							disabled={false}
							dragDisabled
							groups={[]}
							index={0}
							onMove={() => undefined}
							onUnpin={() => undefined}
							profileId="human"
							section="spaces"
							selected={false}
							title="Planning"
							unreadCount={0}
							url={url}
						/>
					</FluidNavMenu>
				</TooltipProvider>
			</QueryClientProvider>
		),
	});
	const destination = createRoute({
		getParentRoute: () => root,
		path: `/o/team/${target.startsWith("spaces") ? "spaces" : "chats"}/$spaceId`,
		validateSearch: (value: Record<string, unknown>) => value,
		loaderDeps: ({ search: value }) => value,
		loader: ({ params, deps }) =>
			loader({ spaceId: params.spaceId, search: deps }),
	});
	const router = createRouter({
		routeTree: root.addChildren([index, destination]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
		defaultPreload: "intent",
		defaultPreloadDelay: 0,
	});
	await router.load();
	render(<RouterProvider router={router} />);
	const link = await screen.findByRole("link", {
		name: "Planning",
	});
	fireEvent.mouseEnter(link);
	await waitFor(() => expect(loader).toHaveBeenCalledWith({ spaceId, search }));
	expect(router.state.location.pathname).toBe("/");
	expect(link.getAttribute("href")).toBe(url);
	const avatar = screen.getByLabelText("Space");
	expect(link.contains(avatar)).toBe(true);
	fireEvent.click(avatar);
	await waitFor(() =>
		expect(router.state.location.pathname).toBe(url.split("?")[0])
	);
	cleanup();
	client.clear();
});

it("uses committed menu actions and updates changed row data after a parent refresh", async () => {
	const originalMove = vi.fn();
	const currentMove = vi.fn();
	const item = fixtureSpace("planning", "Planning");
	const groups = [{ id: "space:work", name: "Work" }];
	const client = new QueryClient();
	function Fixture() {
		const [revision, setRevision] = useState(0);
		const title = revision === 2 ? "New planning" : "Planning";
		return (
			<QueryClientProvider client={client}>
				<TooltipProvider>
					<button
						onClick={() => setRevision((value) => value + 1)}
						type="button"
					>
						Refresh row
					</button>
					<FluidNavMenu activeValue={null}>
						<ConversationSidebarRow
							archived={false}
							attentionTone={null}
							conversation={{
								kind: "space",
								item: revision === 2 ? { ...item, spaceName: title } : item,
								spaceId: item.spaceId,
								title,
								activity: 0,
								url: "/o/team/spaces/planning?profileId=human",
								profileId: "human",
							}}
							disabled={false}
							dragDisabled
							groups={
								revision === 2
									? [{ id: "space:new", name: "New group" }]
									: groups
							}
							index={0}
							onMove={revision === 0 ? originalMove : currentMove}
							onUnpin={() => undefined}
							profileId="human"
							section="spaces"
							selected={revision === 2}
							title={title}
							unreadCount={revision === 2 ? 1 : 0}
							url="/o/team/spaces/planning?profileId=human"
						/>
					</FluidNavMenu>
				</TooltipProvider>
			</QueryClientProvider>
		);
	}
	const root = createRootRoute({ component: Fixture });
	const router = createRouter({
		routeTree: root,
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	fireEvent.click(await screen.findByRole("button", { name: "Refresh row" }));
	const actions = screen.getByRole("button", { name: "Actions for Planning" });
	// A row action like Pin: same hover treatment, and the row keeps its
	// action gutter while the menu is open.
	expect(actions.getAttribute("data-sidebar")).toBe("menu-action");
	fireEvent.click(actions);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Move to Work" })
	);
	expect(currentMove).toHaveBeenCalledWith("space:work");
	expect(originalMove).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Refresh row" }));
	const link = screen.getByRole("link", {
		name: "New planning, unread updates",
	});
	expect(link.getAttribute("aria-current")).toBe("page");
	fireEvent.click(
		screen.getByRole("button", { name: "Actions for New planning" })
	);
	expect(
		await screen.findByRole("menuitem", { name: "Move to New group" })
	).toBeTruthy();
	expect(screen.queryByRole("menuitem", { name: "Move to Work" })).toBeNull();
	cleanup();
	client.clear();
});
