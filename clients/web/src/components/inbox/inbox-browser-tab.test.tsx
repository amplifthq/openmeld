import type { InboxSummaryResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { InboxBrowserTab } from "./inbox-browser-tab";

describe("Inbox browser tab lifecycle", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		for (const icon of document.head.querySelectorAll('link[rel~="icon"]')) {
			icon.remove();
		}
	});

	it("restores icons on scope exit and discards an old scope's pending render", async () => {
		vi.stubGlobal(
			"matchMedia",
			(media: string): MediaQueryList => ({
				media,
				matches: false,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(() => true),
			})
		);
		const client = new QueryClient();
		const summary: InboxSummaryResponse = {
			organizationId: "org-a",
			totalUnreadCount: 127,
			unresolvedActionCount: 0,
			unreadUrgentUpdateCount: 0,
		};
		client.setQueryData(inboxQueryKeys.summary("org-a"), summary);
		client.setQueryData(inboxQueryKeys.summary("org-b"), {
			...summary,
			organizationId: "org-b",
			totalUnreadCount: 0,
		});
		document.title = "Inbox | OpenMeld";
		const icon = document.createElement("link");
		icon.rel = "icon";
		icon.type = "image/png";
		icon.setAttribute("sizes", "32x32");
		icon.href = "/favicon-32x32.png";
		document.head.appendChild(icon);
		const originalHref = icon.href;
		let finishDecode: () => void = () => undefined;
		const decode = vi.fn<() => Promise<void>>().mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishDecode = resolve;
				})
		);
		vi.stubGlobal(
			"Image",
			class extends Image {
				decode = decode;
			}
		);
		const context = {
			drawImage: vi.fn(),
			beginPath: vi.fn(),
			arc: vi.fn(),
			fill: vi.fn(),
			stroke: vi.fn(),
		} satisfies Partial<CanvasRenderingContext2D>;
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as unknown as CanvasRenderingContext2D
		);
		vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
			"data:image/png;base64,aW5ib3g="
		);
		const app = (organizationId: string) => (
			<QueryClientProvider client={client}>
				<ThemeProvider forcedTheme="dark">
					<InboxBrowserTab
						key={organizationId}
						organizationId={organizationId}
					/>
				</ThemeProvider>
			</QueryClientProvider>
		);
		const view = render(app("org-a"));
		await waitFor(() => expect(decode).toHaveBeenCalledOnce());
		expect(document.title).toBe("127 unread · Inbox | OpenMeld");
		view.rerender(app("org-b"));
		await act(async () => {
			finishDecode();
			await Promise.resolve();
		});
		expect(document.title).toBe("Inbox | OpenMeld");
		expect(icon.href).toBe(originalHref);
		decode.mockResolvedValue();
		view.rerender(app("org-a"));
		await waitFor(() =>
			expect(icon.href).toBe("data:image/png;base64,aW5ib3g=")
		);
		view.unmount();
		expect(icon.href).toBe(originalHref);
		expect(document.title).toBe("Inbox | OpenMeld");
		client.clear();
	});
});
