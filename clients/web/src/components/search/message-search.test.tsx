import type { MessageSearchResponse } from "@openmeld/schemas";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageSearchButton, useMessageSearch } from "./message-search";

const request = vi.hoisted(() => vi.fn());
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: () => ({
		requestJson: request,
	}),
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentUserId: "viewer",
		currentOrganization: { id: "org", slug: "test" },
	}),
	useOptionalAppOrganization: () => ({ id: "org", slug: "test" }),
}));
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({
		defaultHumanProfile: { openMeldProfileId: "human" },
	}),
}));
describe("message search", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.resetAllMocks();
	});

	it("debounces input, defers IME composition, and cancels obsolete searches", async () => {
		vi.useFakeTimers();
		const pending: Array<{
			signal: AbortSignal;
			resolve: (value: MessageSearchResponse) => void;
		}> = [];
		request.mockImplementation(
			({ signal }: { signal: AbortSignal }) =>
				new Promise<MessageSearchResponse>((resolve) =>
					pending.push({ signal, resolve })
				)
		);
		const client = new QueryClient();
		const { result, rerender, unmount } = renderHook(useMessageSearch, {
			initialProps: {
				draft: "",
				isComposing: false,
				spaceId: undefined as string | undefined,
			},
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		});
		rerender({ draft: "light", isComposing: false, spaceId: undefined });
		await act(() => vi.advanceTimersByTimeAsync(200));
		rerender({ draft: "lighthouse", isComposing: false, spaceId: undefined });
		await act(() => vi.advanceTimersByTimeAsync(299));
		expect(request).not.toHaveBeenCalled();
		await act(() => vi.advanceTimersByTimeAsync(1));
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0]?.[0].url).toContain("q=lighthouse");
		rerender({ draft: "历史消息", isComposing: true, spaceId: undefined });
		expect(pending[0]?.signal.aborted).toBe(true);
		await act(() => vi.advanceTimersByTimeAsync(500));
		expect(request).toHaveBeenCalledTimes(1);
		rerender({ draft: "历史消息", isComposing: false, spaceId: undefined });
		await act(() => vi.advanceTimersByTimeAsync(300));
		expect(request).toHaveBeenCalledTimes(2);
		await act(async () => {
			pending[0]?.resolve({
				matches: [],
				activities: [],
				nextCursor: null,
				indexing: false,
			});
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.query).toBe("历史消息");
		expect(result.current.searching).toBe(true);
		rerender({ draft: "", isComposing: false, spaceId: undefined });
		expect(pending[1]?.signal.aborted).toBe(true);
		expect(result.current.searching).toBe(false);
		rerender({ draft: "ab", isComposing: false, spaceId: undefined });
		await act(() => vi.advanceTimersByTimeAsync(300));
		expect(request).toHaveBeenCalledTimes(2);
		rerender({ draft: "a", isComposing: false, spaceId: "space-1" });
		await act(() => vi.advanceTimersByTimeAsync(300));
		expect(request).toHaveBeenCalledTimes(3);
		expect(request.mock.calls[2]?.[0].url).toContain("/v1/messages/query?q=a");
		expect(request.mock.calls[2]?.[0].url).toContain("spaceId=space-1");
		rerender({ draft: "final", isComposing: false, spaceId: undefined });
		await act(() => vi.advanceTimersByTimeAsync(300));
		expect(pending[2]?.signal.aborted).toBe(true);
		unmount();
		expect(pending[3]?.signal.aborted).toBe(true);
		client.clear();
	});

	it("uses an icon-only Space action and a centered initial state", () => {
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<TooltipProvider>
					<MessageSearchButton profileId="human" spaceId="space-1" />
				</TooltipProvider>
			</QueryClientProvider>
		);
		const button = screen.getByLabelText("Search messages");
		expect(button.textContent).toBe("");
		expect(button.className).toContain("size-7");
		fireEvent.click(button);
		expect(screen.getByText("Start typing to search")).toBeTruthy();
		expect(screen.getByText("Results will appear here.")).toBeTruthy();
		expect(screen.queryByText("Use at least 3 characters.")).toBeNull();
		client.clear();
	});
});
