import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPACE_CONVERSATION_LAYOUT_BOOTSTRAP_SCRIPT } from "../lib/spaces/conversation-layout-preference";
import { SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT } from "../lib/spaces/self-message-alignment-preference";
import { DesktopFrame } from "./desktop-frame";

const native = vi.hoisted(() => ({ available: false }));
const bridge = vi.hoisted(() => ({
	onSessionChanged: () => () => undefined,
}));
const router = vi.hoisted(() => ({}));

vi.mock("./platform", () => ({
	getDesktopPlatform: () => (native.available ? bridge : null),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useRouter: () => router,
	useLocation: () => "/desktop-shell",
}));

afterEach(() => {
	native.available = false;
	window.localStorage.clear();
});

describe("Desktop document hydration", () => {
	it.each([
		[null, null, "centered", "left"],
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
