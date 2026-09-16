import type {
	ListSpaceThreadsResponse,
	SignalEnvelope,
} from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	boundSavedSpaceHistory,
	boundSpaceThreadDisplay,
	mergeSpaceHistorySnapshots,
	readSpaceUpdates,
	SPACE_DATE_HISTORY_PAGE_MAX_MESSAGES,
	SPACE_SAVED_HISTORY_MAX_BYTES,
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
	it("keeps only bounded reply previews for retained roots and preserves them across a main-message refresh", () => {
		const messages = [createTextSignal({ id: "root", ts: 1 })];
		const thread = {
			threadId: "thread-a",
			rootSignalId: "root",
			spaceId: "space-a",
			createdByProfileId: "human-a",
			createdAt: "2026-09-14T00:00:00.000Z",
			updatedAt: "2026-09-14T00:00:00.000Z",
		};
		const snapshot: ListSpaceThreadsResponse = {
			threads: [
				thread,
				{ ...thread, threadId: "thread-b", rootSignalId: "absent" },
			],
			previews: [
				{
					threadId: "thread-a",
					replyCount: 300,
					signals: [1, 2, 3].map((i) =>
						createTextSignal({ id: `reply-${i}`, ts: i })
					),
					placements: [],
				},
			],
		};
		const display = boundSpaceThreadDisplay(messages, snapshot);
		expect(display.threads).toEqual([thread]);
		expect(display.previews[0]?.replyCount).toBe(300);
		expect(display.previews[0]?.signals.map((s) => s.id)).toEqual([
			"reply-1",
			"reply-2",
		]);
		const current = {
			envelopes: messages,
			nextCursor: null,
			threadDisplay: display,
		};
		const merged = mergeSpaceHistorySnapshots({
			current,
			incoming: { envelopes: messages, nextCursor: null },
		});
		expect(merged).toBe(current);
		expect(boundSpaceThreadDisplay([], snapshot)).toEqual({
			threads: [],
			previews: [],
		});
		const oversized = createTextSignal({ id: "large-reply", ts: 1 });
		if (oversized.type !== "signal.text") {
			throw new Error("Expected a text fixture.");
		}
		oversized.data.text = "x".repeat(16 * 1024);
		expect(
			boundSpaceThreadDisplay(messages, {
				threads: [thread],
				previews: [
					{
						threadId: thread.threadId,
						replyCount: 300,
						signals: [oversized],
						placements: [],
					},
				],
			}).previews
		).toEqual([
			{
				threadId: thread.threadId,
				replyCount: 300,
				signals: [],
				placements: [],
			},
		]);
	});
	it("retains loaded pages when a fresh 30-message tail arrives", () => {
		const messages = Array.from({ length: 100 }, (_, i) =>
			createTextSignal({ id: `message-${i}`, ts: i })
		);
		const merged = mergeSpaceHistorySnapshots({
			current: { envelopes: messages, nextCursor: null },
			incoming: { envelopes: messages.slice(-30), nextCursor: "older" },
		});
		expect(merged.envelopes).toEqual(messages);
	});
	it("bounds saved history by payload size and keeps a contiguous recent suffix", () => {
		const messages = Array.from(
			{ length: 6 },
			(_, i) =>
				({
					...createTextSignal({ id: `large-${i}`, ts: i }),
					data: { text: "x".repeat(512 * 1024) },
				}) as SignalEnvelope
		);
		const bounded = boundSavedSpaceHistory(messages);
		expect(bounded.map((message) => message.id)).toEqual([
			"large-3",
			"large-4",
			"large-5",
		]);
		expect(
			new TextEncoder().encode(JSON.stringify(bounded)).byteLength
		).toBeLessThan(SPACE_SAVED_HISTORY_MAX_BYTES);
		expect(messages).toHaveLength(6);
	});
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
