import { afterEach, describe, expect, it, vi } from "vitest";
import { readSpaceBootstrap, spaceBootstrapQueryOptions } from "./bootstrap";
import {
	SPACE_HISTORY_SIGNAL_KINDS,
	SPACE_INITIAL_HISTORY_MAX_MESSAGES,
} from "./history";
import { SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS } from "./status";

const getBootstrapMock = vi.hoisted(() => vi.fn());
const createWebSpaceApiMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: (
		...args: Parameters<typeof createWebSpaceApiMock>
	) => createWebSpaceApiMock(...args),
}));

describe("spaceBootstrapQueryOptions", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("uses the explicit OpenMeld profile id for bootstrap reads and cache keys", async () => {
		getBootstrapMock.mockResolvedValue(createBootstrapResponse());
		createWebSpaceApiMock.mockReturnValue({
			getBootstrap: getBootstrapMock,
		});

		const queryOptions = spaceBootstrapQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			enabled: true,
		});
		const result = await readSpaceBootstrap({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
		});

		expect(queryOptions.queryKey).toEqual([
			"spaces",
			"bootstrap",
			"space-123",
			"profile-123",
		]);
		expect(createWebSpaceApiMock).toHaveBeenCalledWith({
			openMeldProfileId: "profile-123",
		});
		expect(getBootstrapMock).toHaveBeenCalledWith({
			spaceId: "space-123",
			includeAgentStreamPresence: true,
			historyQuery: {
				recent: true,
				limit: SPACE_INITIAL_HISTORY_MAX_MESSAGES,
				kinds: SPACE_HISTORY_SIGNAL_KINDS,
			},
		});
		expect(result.history).toEqual({
			envelopes: [],
			nextCursor: null,
		});
	});

	it("keeps bootstrap snapshots briefly fresh instead of always refetching on mount", () => {
		const queryOptions = spaceBootstrapQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			enabled: true,
		});

		expect(queryOptions.staleTime).toBe(SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS);
		expect(queryOptions.refetchOnMount).toBe(true);
	});

	it("passes the TanStack Query abort signal to bootstrap reads", async () => {
		const controller = new AbortController();
		getBootstrapMock.mockResolvedValue(createBootstrapResponse());
		createWebSpaceApiMock.mockReturnValue({
			getBootstrap: getBootstrapMock,
		});

		const queryOptions = spaceBootstrapQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			enabled: true,
		});

		await (
			queryOptions.queryFn as (context: {
				signal: AbortSignal;
			}) => Promise<unknown>
		)({ signal: controller.signal });

		expect(getBootstrapMock).toHaveBeenCalledWith({
			spaceId: "space-123",
			includeAgentStreamPresence: true,
			historyQuery: {
				recent: true,
				limit: SPACE_INITIAL_HISTORY_MAX_MESSAGES,
				kinds: SPACE_HISTORY_SIGNAL_KINDS,
			},
			signal: controller.signal,
		});
	});
});

function createBootstrapResponse() {
	return {
		status: {
			spaceId: "space-123",
			generatedAt: "2026-04-03T00:00:00.000Z",
			name: "Design Room",
			accessMode: "public",
			passwordProtected: false,
			dispatchPolicy: { mode: "mention_only" },
			publicationMode: "collaboration",
			allowedActions: ["post_message", "post_status", "stay_silent"],
			resultArchivePolicy: { mode: "all_final_results" },
			entryBrief: "default",
			dispatchBrief: "default",
			members: {
				totalCount: 0,
				humanCount: 0,
				agentCount: 0,
				liveNowCount: 0,
				liveHumanCount: 0,
				liveAgentCount: 0,
			},
		},
		members: {
			spaceId: "space-123",
			generatedAt: "2026-04-03T00:00:00.000Z",
			summary: {
				totalCount: 0,
				humanCount: 0,
				agentCount: 0,
				liveNowCount: 0,
			},
			humans: [],
			agents: [],
		},
		history: {
			signals: [],
			nextCursor: null,
		},
		threads: {
			threads: [],
			previews: [],
		},
	};
}
