import { afterEach, describe, expect, it, vi } from "vitest";
import {
	readSpaceStatus,
	SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS,
	spaceStatusQueryOptions,
} from "./status";

const getStatusMock = vi.hoisted(() => vi.fn());
const createWebSpaceApiMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/spaces/api", () => ({
	createWebSpaceApi: (...args: Parameters<typeof createWebSpaceApiMock>) =>
		createWebSpaceApiMock(...args),
}));

describe("spaceStatusQueryOptions", () => {
	afterEach(() => {
		vi.clearAllMocks();
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
			signal: controller.signal,
		});
	});
});
