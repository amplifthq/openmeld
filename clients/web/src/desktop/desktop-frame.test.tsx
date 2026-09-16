import type { DesktopSession } from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	type RouterHistory,
} from "@tanstack/react-router";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { SPACE_CONVERSATION_LAYOUT_BOOTSTRAP_SCRIPT } from "../lib/spaces/conversation-layout-preference";
import { SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT } from "../lib/spaces/self-message-alignment-preference";
import { DesktopFrame } from "./desktop-frame";
import { useDesktopTitlebar } from "./titlebar-context";

const native = vi.hoisted(() => ({
	available: false,
	pathname: "/desktop-shell",
}));
const bridge = vi.hoisted(() => ({
	onSessionChanged: vi.fn<(callback: () => void) => () => void>(
		() => () => undefined
	),
	session: vi.fn<() => Promise<DesktopSession>>(),
}));
const router = vi.hoisted(() => ({
	history: null as RouterHistory | null,
	invalidate: vi.fn(() => Promise.resolve()),
}));

vi.mock("./platform", () => ({
	getDesktopPlatform: () => (native.available ? bridge : null),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useRouter: () => router,
	useLocation: () => native.pathname,
}));

beforeEach(() => {
	router.history = createMemoryHistory({ initialEntries: ["/desktop-shell"] });
});
afterEach(() => {
	native.available = false;
	native.pathname = "/desktop-shell";
	cleanup();
	window.localStorage.clear();
});

describe("Desktop document hydration", () => {
	it("closes both history directions on native session invalidation before the new account read completes", async () => {
		const history = createMemoryHistory({ initialEntries: ["/o/team/spaces"] });
		router.history = history;
		native.available = true;
		native.pathname = "/o/team/spaces";
		let resolveSession!: (session: DesktopSession) => void;
		bridge.session.mockReturnValue(
			new Promise((resolve) => {
				resolveSession = resolve;
			})
		);
		const controls: { current: ReturnType<typeof useDesktopTitlebar> } = {
			current: null,
		};
		function Probe() {
			controls.current = useDesktopTitlebar();
			return null;
		}
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<DesktopFrame>
					<Probe />
				</DesktopFrame>
			</QueryClientProvider>
		);
		await waitFor(() => expect(controls.current).not.toBeNull());
		if (!controls.current) {
			throw new Error("Missing native titlebar context");
		}
		const navigation = controls.current.navigation;
		act(() => {
			navigation.identify("account-a");
			history.push("/o/team/people");
			history.push("/o/team/inbox");
			navigation.back();
		});
		expect(navigation.getSnapshot()).toEqual({ back: true, forward: true });
		const onSessionChanged = bridge.onSessionChanged.mock.calls.at(-1)?.[0];
		if (!onSessionChanged) {
			throw new Error("Missing native session listener");
		}
		act(onSessionChanged);
		expect(navigation.getSnapshot()).toEqual({ back: false, forward: false });
		await waitFor(() => expect(bridge.session).toHaveBeenCalled());
		await act(() =>
			resolveSession({
				user: { id: "account-b", email: "b@example.com", name: "B" },
			})
		);
		navigation.back();
		navigation.forward();
		expect(history.location.href).toBe("/o/team/people");
		client.clear();
	});
	it.each([
		[null, null, "centered", "right"],
		["centered", "right", "centered", "right"],
		["full-width", "left", "full-width", "left"],
	])("preserves Appearance on first open and reopen with saved %s / %s", async (savedLayout, savedAlignment, layout, alignment) => {
		window.localStorage.clear();
		if (savedLayout) {
			window.localStorage.setItem(
				"openmeld.space.conversation-layout",
				savedLayout
			);
		}
		if (savedAlignment) {
			window.localStorage.setItem(
				"openmeld.space.self-message-alignment",
				savedAlignment
			);
		}
		const queryClient = new QueryClient();
		const page = (
			<QueryClientProvider client={queryClient}>
				<html lang="en" suppressHydrationWarning>
					<head />
					<body>
						<DesktopFrame>
							<main>Welcome Space</main>
						</DesktopFrame>
					</body>
				</html>
			</QueryClientProvider>
		);
		for (let open = 0; open < 2; open++) {
			native.available = false;
			document.open();
			document.write(`<!doctype html>${renderToString(page)}`);
			document.close();
			// Execute the same pre-paint scripts as the packaged document.
			const context = { window, document, console };
			runInNewContext(SPACE_CONVERSATION_LAYOUT_BOOTSTRAP_SCRIPT, context);
			runInNewContext(SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT, context);
			native.available = true;
			const onRecoverableError = vi.fn();
			let root: ReturnType<typeof hydrateRoot> | undefined;
			await act(() => {
				root = hydrateRoot(document, page, { onRecoverableError });
			});
			expect(onRecoverableError).not.toHaveBeenCalled();
			expect(document.querySelector(".desktop-content main")?.textContent).toBe(
				"Welcome Space"
			);
			expect(
				document.documentElement.getAttribute("data-space-conversation-layout")
			).toBe(layout);
			expect(
				document.documentElement.getAttribute(
					"data-space-self-message-alignment"
				)
			).toBe(alignment);
			expect(
				window.localStorage.getItem("openmeld.space.conversation-layout")
			).toBe(savedLayout);
			expect(
				window.localStorage.getItem("openmeld.space.self-message-alignment")
			).toBe(savedAlignment);
			await act(() => root?.unmount());
		}
		queryClient.clear();
	});
});

import { runInNewContext } from "node:vm";
