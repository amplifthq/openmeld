import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ signOut: vi.fn() }));
const completeAccountAuthChange = vi.hoisted(() => vi.fn());

vi.mock("#/desktop/platform", () => ({ getDesktopPlatform: () => desktop }));
vi.mock("#/query/auth-boundary", () => ({ completeAccountAuthChange }));

import { useSignOut } from "./auth.hooks";

beforeEach(() => {
	desktop.signOut.mockReset();
	completeAccountAuthChange.mockReset();
});

afterEach(cleanup);

describe("useSignOut", () => {
	it("clears Desktop private state after the native SDK clears its cookie even when remote revocation fails", async () => {
		desktop.signOut.mockRejectedValue(new Error("Remote revoke unavailable"));
		const queryClient = new QueryClient({
			defaultOptions: { mutations: { retry: false } },
		});
		const { result } = renderHook(() => useSignOut(), {
			wrapper: ({ children }: PropsWithChildren) => (
				<QueryClientProvider client={queryClient}>
					{children}
				</QueryClientProvider>
			),
		});

		await act(async () => {
			await expect(result.current.mutateAsync()).rejects.toThrow(
				"Remote revoke unavailable"
			);
		});

		expect(desktop.signOut).toHaveBeenCalledTimes(1);
		expect(completeAccountAuthChange).toHaveBeenCalledWith(
			queryClient,
			"signed-out"
		);
		queryClient.clear();
	});
});
