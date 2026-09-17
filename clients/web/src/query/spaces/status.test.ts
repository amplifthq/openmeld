import { onlineManager, QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spaceEntryResolutionQueryOptions } from "./entry-resolution";
import {
	readSpaceStatus,
	SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS,
	spaceStatusQueryOptions,
} from "./status";

const getStatusMock = vi.hoisted(() => vi.fn());
const createWebSpaceApiMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: (
		...args: Parameters<typeof createWebSpaceApiMock>
	) => createWebSpaceApiMock(...args),
}));

describe("spaceStatusQueryOptions", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		"status",
		"entry",
	] as const)("settles %s admission while offline instead of pausing the send", async (kind) => {
		const client = new QueryClient();
		const wasOnline = onlineManager.isOnline();
		const failure = new TypeError("Failed to fetch");
		createWebSpaceApiMock.mockReturnValue({
			getStatus: vi.fn().mockRejectedValue(failure),
			resolveEntry: vi.fn().mockRejectedValue(failure),
		});
		onlineManager.setOnline(false);
		try {
			const input = { spaceId: "space-123", enabled: true };
			const options =
				kind === "status"
					? spaceStatusQueryOptions(input)
					: spaceEntryResolutionQueryOptions(input);
			// Exercise the configured query function/mode with actual QueryClient
			// scheduling; remove backoff only to keep this regression deterministic.
			const request =
				kind === "status"
					? client.fetchQuery({
							...spaceStatusQueryOptions(input),
							retry: false,
						})
					: client.fetchQuery({
							...spaceEntryResolutionQueryOptions(input),
							retry: false,
						});
			await expect(request).rejects.toMatchObject({
				message: "Failed to fetch",
			});
			expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe("idle");
		} finally {
			onlineManager.setOnline(wasOnline);
			client.clear();
		}
	});

	it("uses the explicit OpenMeld profile id for status reads and cache keys", async () => {
		getStatusMock.mockResolvedValue({
			spaceId: "space-123",
			name: "Design Room",
		});
		createWebSpaceApiMock.mockReturnValue({
			getStatus: getStatusMock,
		});

		const queryOptions = spaceStatusQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			enabled: true,
		});
		const result = await readSpaceStatus({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
		});

		expect(queryOptions.queryKey).toEqual([
			"spaces",
			"status",
			"space-123",
			"profile-123",
		]);
		expect(createWebSpaceApiMock).toHaveBeenCalledWith({
			openMeldProfileId: "profile-123",
		});
		expect(getStatusMock).toHaveBeenCalledWith({
			spaceId: "space-123",
			timeoutMs: 15_000,
		});
		expect(result).toEqual({
			spaceId: "space-123",
			name: "Design Room",
		});
	});

	it("keeps initial status snapshots briefly fresh instead of always refetching on mount", () => {
		const queryOptions = spaceStatusQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			enabled: true,
		});

		expect(queryOptions.staleTime).toBe(SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS);
		expect(queryOptions.refetchOnMount).toBe(true);
	});

	it("passes the TanStack Query abort signal to status reads", async () => {
		const controller = new AbortController();
		getStatusMock.mockResolvedValue({
			spaceId: "space-123",
			name: "Design Room",
		});
		createWebSpaceApiMock.mockReturnValue({
			getStatus: getStatusMock,
		});

		const queryOptions = spaceStatusQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			enabled: true,
		});

		await (
			queryOptions.queryFn as (context: {
				signal: AbortSignal;
			}) => Promise<unknown>
		)({ signal: controller.signal });

		expect(getStatusMock).toHaveBeenCalledWith({
			spaceId: "space-123",
			timeoutMs: 15_000,
			signal: controller.signal,
		});
	});
});
