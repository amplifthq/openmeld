import type { MessageSearchResponse } from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useMessageSearch } from "./message-search";

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
}));
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({
		defaultHumanProfile: { openMeldProfileId: "human" },
	}),
}));
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
		initialProps: { draft: "", isComposing: false },
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
	rerender({ draft: "light", isComposing: false });
	await act(() => vi.advanceTimersByTimeAsync(200));
	rerender({ draft: "lighthouse", isComposing: false });
	await act(() => vi.advanceTimersByTimeAsync(299));
	expect(request).not.toHaveBeenCalled();
	await act(() => vi.advanceTimersByTimeAsync(1));
	expect(request).toHaveBeenCalledTimes(1);
	expect(request.mock.calls[0]?.[0].url).toContain("q=lighthouse");
	rerender({ draft: "历史消息", isComposing: true });
	expect(pending[0]?.signal.aborted).toBe(true);
	await act(() => vi.advanceTimersByTimeAsync(500));
	expect(request).toHaveBeenCalledTimes(1);
	rerender({ draft: "历史消息", isComposing: false });
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
	rerender({ draft: "", isComposing: false });
	expect(pending[1]?.signal.aborted).toBe(true);
	expect(result.current.searching).toBe(false);
	rerender({ draft: "ab", isComposing: false });
	await act(() => vi.advanceTimersByTimeAsync(300));
	expect(request).toHaveBeenCalledTimes(2);
	rerender({ draft: "final", isComposing: false });
	await act(() => vi.advanceTimersByTimeAsync(300));
	unmount();
	expect(pending[2]?.signal.aborted).toBe(true);
	client.clear();
});
