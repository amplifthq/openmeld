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
