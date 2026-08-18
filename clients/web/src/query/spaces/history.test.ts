import type { SignalEnvelope } from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	readSpaceUpdates,
	SPACE_DATE_HISTORY_PAGE_MAX_MESSAGES,
	spaceHistoryDateWindowQueryOptions,
	spaceHistoryQueryOptions,
} from "./history";
import { SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS } from "./status";

const getUpdatesMock = vi.hoisted(() => vi.fn());
const listSignalEnvelopesMock = vi.hoisted(() => vi.fn());
const createWebSpaceApiMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: (
		...args: Parameters<typeof createWebSpaceApiMock>
	) => createWebSpaceApiMock(...args),
}));

describe("space history helpers", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("uses the explicit OpenMeld profile id for history cache keys", () => {
		expect(
			spaceHistoryQueryOptions({
				spaceId: "space-123",
				openMeldProfileId: "profile-123",
				enabled: true,
			}).queryKey
		).toEqual(["spaces", "history", "space-123", "profile-123"]);
	});

	it("keeps initial history snapshots briefly fresh instead of always refetching on mount", () => {
		const queryOptions = spaceHistoryQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			enabled: true,
		});

		expect(queryOptions.staleTime).toBe(SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS);
		expect(queryOptions.refetchOnMount).toBe(true);
	});

	it("does not let a late older refetch replace newer cached signals", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
				},
			},
		});
		const olderSignal = createTextSignal({ id: "sig-1", ts: 10 });
		const newerSignal = createTextSignal({ id: "sig-2", ts: 20 });
		listSignalEnvelopesMock.mockResolvedValue({
			envelopes: [olderSignal],
			nextCursor: "cursor-before-sig-1",
		});
		createWebSpaceApiMock.mockReturnValue({
			listSignalEnvelopes: listSignalEnvelopesMock,
		});
		const queryOptions = spaceHistoryQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			enabled: true,
		});

		try {
			queryClient.setQueryData(queryOptions.queryKey, {
				envelopes: [newerSignal],
				nextCursor: null,
			});
			await queryClient.fetchQuery({
				...queryOptions,
				staleTime: 0,
			});

			expect(
				queryClient
					.getQueryData<{ envelopes: readonly SignalEnvelope[] }>(
						queryOptions.queryKey
					)
					?.envelopes.map((signal) => signal.id)
			).toEqual(["sig-1", "sig-2"]);
		} finally {
			queryClient.clear();
		}
	});

	it("passes the TanStack Query abort signal to initial history reads", async () => {
		const controller = new AbortController();
		listSignalEnvelopesMock.mockResolvedValue({
			envelopes: [],
			nextCursor: null,
		});
		createWebSpaceApiMock.mockReturnValue({
			listSignalEnvelopes: listSignalEnvelopesMock,
		});

		const queryOptions = spaceHistoryQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			enabled: true,
		});

		await (
			queryOptions.queryFn as (context: {
				signal: AbortSignal;
			}) => Promise<unknown>
		)({ signal: controller.signal });

		expect(listSignalEnvelopesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				spaceId: "space-123",
				signal: controller.signal,
			})
		);
	});

	it("reads and caches a bounded history window from the selected date", async () => {
		const controller = new AbortController();
		listSignalEnvelopesMock.mockResolvedValue({
			envelopes: [],
			nextCursor: null,
		});
		createWebSpaceApiMock.mockReturnValue({
			listSignalEnvelopes: listSignalEnvelopesMock,
		});
		const startAtMs = 1_786_291_200_000;
		const queryOptions = spaceHistoryDateWindowQueryOptions({
			spaceId: "space-123",
			startAtMs,
			openMeldProfileId: "profile-123",
		});

		expect(queryOptions.queryKey).toEqual([
			"spaces",
			"history-date-window",
			"space-123",
			"profile-123",
			startAtMs,
		]);
		await (
			queryOptions.queryFn as (context: {
				signal: AbortSignal;
			}) => Promise<unknown>
		)({ signal: controller.signal });

		expect(listSignalEnvelopesMock).toHaveBeenCalledWith({
			query: {
				afterTs: startAtMs - 1,
				kinds: ["text", "status", "system_notice"],
				limit: SPACE_DATE_HISTORY_PAGE_MAX_MESSAGES,
			},
			signal: controller.signal,
			spaceId: "space-123",
		});
	});

	it("uses the explicit OpenMeld profile id when reading live updates", async () => {
		getUpdatesMock.mockResolvedValue({
			signals: [],
		});
		listSignalEnvelopesMock.mockResolvedValue({
			envelopes: [],
			nextCursor: null,
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
			listSignalEnvelopes: listSignalEnvelopesMock,
		});

		await readSpaceUpdates({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			afterSignalId: "sig-1",
		});

		expect(createWebSpaceApiMock).toHaveBeenCalledWith({
			openMeldProfileId: "profile-123",
		});
		expect(getUpdatesMock).toHaveBeenCalledWith({
			spaceId: "space-123",
			afterSignalId: "sig-1",
			limit: 50,
		});
	});

	it("passes abort signals to live update reads", async () => {
		const controller = new AbortController();
		getUpdatesMock.mockResolvedValue({
			signals: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
		});

		await readSpaceUpdates({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			afterSignalId: "sig-1",
			signal: controller.signal,
		});

		expect(getUpdatesMock).toHaveBeenCalledWith({
			spaceId: "space-123",
			afterSignalId: "sig-1",
			limit: 50,
			signal: controller.signal,
		});
	});
});

function createTextSignal(input: { id: string; ts: number }): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts,
		profile: {
			kind: "human",
			profileId: "profile-123",
			profileName: "Mira",
		},
		type: "signal.text",
		data: { text: input.id },
	} as SignalEnvelope;
}
