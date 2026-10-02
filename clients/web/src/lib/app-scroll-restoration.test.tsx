import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	useLocation,
} from "@tanstack/react-router";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	getAppScrollRestorationKey,
	shouldRestoreAppScroll,
} from "./app-scroll-restoration";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it.each([
	["/o/example/spaces/room", 900],
	["/o/example/chats/room", 900],
	["/o/example/direct-messages/room", 900],
	["/spaces/public-room", 900],
	["/o/example/desk", 900],
	["/o/example/spaces", 120],
	["/o/example/settings", 120],
])("restores %s without overwriting conversation-owned positioning", async (pathname, expected) => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
	function Page() {
		const path = useLocation({ select: (location) => location.pathname });
		return <Viewport key={path} path={path} />;
	}
	function Viewport({ path }: { path: string }) {
		const ref = useRef<HTMLDivElement>(null);
		useLayoutEffect(() => {
			if (ref.current) {
				// A conversation restores its semantic position before route acknowledgement.
				ref.current.scrollTop = 900;
			}
		}, []);
		return (
			<div data-scroll-restoration-id={pathname} ref={ref}>
				{path}
			</div>
		);
	}
	const root = createRootRoute();
	const route = createRoute({
		getParentRoute: () => root,
		path: "$",
		component: Page,
	});
	const router = createRouter({
		routeTree: root.addChildren([route]),
		history: createMemoryHistory({ initialEntries: [pathname] }),
		scrollRestoration: shouldRestoreAppScroll,
		getScrollRestorationKey: getAppScrollRestorationKey,
	});
	render(<RouterProvider router={router} />);
	const first = await screen.findByText(pathname);
	first.scrollTop = 120;
	fireEvent.scroll(first);
	await act(() => router.navigate({ to: "/" }));
	await screen.findByText("/");
	await act(() => router.navigate({ to: pathname }));
	expect((await screen.findByText(pathname)).scrollTop).toBe(expected);
});
