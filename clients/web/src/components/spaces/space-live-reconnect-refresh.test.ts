import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spaceFileQueryKeys } from "#/query/spaces/space-files";
import { refreshLiveInvalidatedSnapshotsAfterReconnect } from "./use-space-landing-feed";

describe("refreshLiveInvalidatedSnapshotsAfterReconnect", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("re-reads every snapshot a withheld live invalidation would have refreshed", async () => {
		vi.useFakeTimers();
		const queryClient = new QueryClient();
		const invalidated: unknown[] = [];
		vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
			const queryKey = (filters as { queryKey?: unknown })?.queryKey;
			invalidated.push(queryKey ?? "predicate");
			return Promise.resolve();
		});
		const statusRefetch = vi.fn().mockResolvedValue(undefined);
		const membersRefetch = vi.fn().mockResolvedValue(undefined);

		refreshLiveInvalidatedSnapshotsAfterReconnect({
			membersRefetch,
			membersRefetchTimerRef: { current: null },
			openMeldProfileId: "profile-viewer",
			queryClient,
			spaceId: "space-123",
			statusRefetch,
			statusRefetchTimerRef: { current: null },
			wakeProgressRefreshScopeRef: { current: null },
		});
		await vi.runAllTimersAsync();

		// Tasks, files, access, and Agent progress have no other recovery path
		// after Core withholds their invalidation frames and closes the socket.
		expect(invalidated).toEqual(
			expect.arrayContaining([
				["space-tasks", "space-123"],
				spaceFileQueryKeys.space("space-123"),
				["spaces", "entry-resolution", "space-123"],
				[
					"spaces",
					"active-wake-progress-summary",
					"space-123",
					"profile-viewer",
				],
			])
		);
		expect(statusRefetch).toHaveBeenCalledTimes(1);
		expect(membersRefetch).toHaveBeenCalledTimes(1);
	});
});
