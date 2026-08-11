import {
	SPACE_STREAM_KEEPALIVE_PING,
	SPACE_STREAM_KEEPALIVE_PONG,
} from "@openmeld/protocol";
import type {
	SignalEnvelope,
	SpaceAgentStreamSnapshot,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	readSpaceCursorLastSeenTs,
	writeSpaceCursorLastSeenTs,
} from "#/query/spaces/cursor";
import {
	readSpaceHistory,
	readSpaceUpdates,
	type SpaceHistorySnapshot,
} from "#/query/spaces/history";
import { spaceQueryKeys } from "#/query/spaces/status";
import { useSpaceLandingFeed } from "./use-space-landing-feed";

vi.mock("#/query/spaces/history", async () => {
	const actual = await vi.importActual<typeof import("#/query/spaces/history")>(
		"#/query/spaces/history"
	);
	return {
		...actual,
		readSpaceUpdates: vi.fn(async () => ({ signals: [] })),
		readSpaceHistory: vi.fn(async () => ({ envelopes: [], nextCursor: null })),
	};
});

// The read cursor (SpaceCursor.lastSeenTs) is a different concept from the
// catch-up anchor: reconcile must drive the sync cursor off the latest persisted
// signal id and never read or write the read cursor. Mock the module so any
// accidental coupling shows up as a call on these spies.
vi.mock("#/query/spaces/cursor", () => ({
	readSpaceCursorLastSeenTs: vi.fn(async () => null),
	writeSpaceCursorLastSeenTs: vi.fn(async () => undefined),
}));

const readSpaceUpdatesMock = vi.mocked(readSpaceUpdates);
const readSpaceHistoryMock = vi.mocked(readSpaceHistory);
const readSpaceCursorLastSeenTsMock = vi.mocked(readSpaceCursorLastSeenTs);
const writeSpaceCursorLastSeenTsMock = vi.mocked(writeSpaceCursorLastSeenTs);

type FeedHistoryState = Parameters<typeof useSpaceLandingFeed>[0]["history"];

type FakeWebSocketEvent = { data?: unknown; code?: number; reason?: string };

class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	url: string;
	readonly sentFrames: string[] = [];
	closeCount = 0;
	private readonly listeners = new Map<
		string,
		Set<(event?: FakeWebSocketEvent) => void | Promise<void>>
	>();

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	static reset() {
		FakeWebSocket.instances = [];
	}

	static get latest(): FakeWebSocket {
		const socket = FakeWebSocket.instances.at(-1);
		if (!socket) {
			throw new Error("No FakeWebSocket instance was created");
		}
		return socket;
	}

	addEventListener(
		type: string,
		listener: (event?: FakeWebSocketEvent) => void | Promise<void>
	) {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, new Set());
		}
		this.listeners.get(type)?.add(listener);
	}

	removeEventListener(
		type: string,
		listener: (event?: FakeWebSocketEvent) => void | Promise<void>
	) {
		this.listeners.get(type)?.delete(listener);
	}

	send(data: string) {
		this.sentFrames.push(data);
	}

	close() {
		this.closeCount += 1;
		this.emit("close", { code: 1000, reason: "client_closed" }).catch(
			() => undefined
		);
	}

	async emitOpen() {
		await this.emit("open");
	}

	async emitMessage(data: unknown) {
		await this.emit("message", { data });
	}

	private async emit(type: string, event?: FakeWebSocketEvent) {
		for (const listener of this.listeners.get(type) ?? []) {
			await listener(event);
		}
	}
}

function createTextSignal(input: {
	id: string;
	ts?: number;
	text?: string;
}): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts ?? 10,
		profile: {
			kind: "human",
			profileId: "11111111-1111-1111-1111-111111111111",
			profileName: "Mira",
		},
		type: "signal.text",
		data: { text: input.text ?? "Hello from the stream" },
	} as unknown as SignalEnvelope;
}

function createTextSignalFrame(id: string): string {
	return JSON.stringify(createTextSignal({ id }));
}

function renderFeed(
	options: {
		history?: FeedHistoryState;
		initialAgentStreams?: readonly SpaceAgentStreamSnapshot[];
		onAgentReadinessInvalidated?: (input: {
			agentProfileIds: readonly string[];
		}) => Promise<void> | void;
		seededEnvelopes?: readonly SignalEnvelope[];
	} = {}
) {
	// Stable references across renders. renderHook's callback runs on every
	// render, so inline functions/objects would create fresh identities each
	// time, re-firing the connection effect (its deps include the refetch
	// callbacks and history.data) in an infinite render loop.
	const statusRefetch = vi.fn(async () => undefined);
	const membersRefetch = vi.fn(async () => undefined);
	const initialHistory =
		options.history ?? createReadyFeedHistory(options.seededEnvelopes ?? []);
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});
	if (initialHistory.data) {
		queryClient.setQueryData<SpaceHistorySnapshot>(
			spaceQueryKeys.history(
				"space-123",
				"11111111-1111-1111-1111-111111111111"
			),
			{
				envelopes: initialHistory.data.envelopes,
				nextCursor: null,
			}
		);
	}
	const view = renderHook(
		(props: { history: FeedHistoryState }) =>
			useSpaceLandingFeed({
				spaceId: "space-123",
				openMeldProfileId: "11111111-1111-1111-1111-111111111111",
				statusReady: true,
				statusRefetch,
				membersRefetch,
				initialAgentStreams: options.initialAgentStreams ?? [],
				onAgentReadinessInvalidated: options.onAgentReadinessInvalidated,
				history: props.history,
			}),
		{
			initialProps: { history: initialHistory },
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={queryClient}>
					{children}
				</QueryClientProvider>
			),
		}
	);
	return { membersRefetch, queryClient, statusRefetch, view };
}

function createReadyFeedHistory(
	envelopes: readonly SignalEnvelope[] = []
): FeedHistoryState {
	return {
		isPending: false,
		isSuccess: true,
		isError: false,
		data: { envelopes },
	};
}

function createPendingFeedHistory(): FeedHistoryState {
	return {
		isPending: true,
		isSuccess: false,
		isError: false,
	};
}

function createSignals(input: {
	count: number;
	startIndex: number;
}): SignalEnvelope[] {
	return Array.from({ length: input.count }, (_, index) => {
		const signalIndex = input.startIndex + index;
		return createTextSignal({
			id: `sig-${signalIndex}`,
			text: `Message ${signalIndex}`,
			ts: signalIndex,
		});
	});
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, reject, resolve };
}

async function flushMicrotasks() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

async function openLatestTransport() {
	await act(async () => {
		await FakeWebSocket.latest.emitOpen();
	});
	await flushMicrotasks();
}

async function acceptLatestLiveSession() {
	await act(async () => {
		await FakeWebSocket.latest.emitMessage(
			JSON.stringify({
				type: "system.hello.ack",
				profile: {
					kind: "human",
					profileId: "11111111-1111-1111-1111-111111111111",
				},
			})
		);
	});
	await flushMicrotasks();
}

async function openLatestSocket() {
	await openLatestTransport();
	await acceptLatestLiveSession();
}

function emitVisibilityChange(state: DocumentVisibilityState) {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => state,
	});
	document.dispatchEvent(new Event("visibilitychange"));
}

describe("useSpaceLandingFeed transport freshness", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
		FakeWebSocket.reset();
		readSpaceUpdatesMock.mockReset();
		readSpaceUpdatesMock.mockResolvedValue({ signals: [] });
		readSpaceHistoryMock.mockReset();
		readSpaceHistoryMock.mockResolvedValue({ envelopes: [], nextCursor: null });
	});

	afterEach(() => {
		cleanup();
		FakeWebSocket.reset();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("does not report the Space live before Core accepts the subscription", async () => {
		const { view } = renderFeed();
		await openLatestTransport();

		expect(view.result.current.liveState).toBe("connecting");

		await acceptLatestLiveSession();

		expect(view.result.current.liveState).toBe("connected");
	});

	it("treats a bare PONG as liveness evidence without surfacing it on the timeline", async () => {
		const { view } = renderFeed();
		await openLatestSocket();

		expect(view.result.current.liveState).toBe("connected");

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(SPACE_STREAM_KEEPALIVE_PONG);
		});
		await flushMicrotasks();

		// PONG is pure liveness: it must never become a timeline signal and must
		// not flip the stream out of connected.
		expect(view.result.current.timelineEnvelopes).toHaveLength(0);
		expect(view.result.current.liveState).toBe("connected");
	});

	it("still routes business signals to the timeline after the PONG fast-path", async () => {
		const { queryClient, view } = renderFeed();
		await openLatestSocket();

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(SPACE_STREAM_KEEPALIVE_PONG);
			await FakeWebSocket.latest.emitMessage(createTextSignalFrame("sig-1"));
		});
		await flushMicrotasks();

		expect(view.result.current.timelineEnvelopes).toHaveLength(1);
		expect(view.result.current.timelineEnvelopes[0]?.id).toBe("sig-1");
		expect(
			queryClient
				.getQueryData<SpaceHistorySnapshot>(
					spaceQueryKeys.history(
						"space-123",
						"11111111-1111-1111-1111-111111111111"
					)
				)
				?.envelopes.map((signal) => signal.id)
		).toEqual(["sig-1"]);
	});

	it("keeps the write-through history cache bounded to the recent window", async () => {
		const { queryClient } = renderFeed({
			seededEnvelopes: createSignals({ count: 30, startIndex: 0 }),
		});

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify(createTextSignal({ id: "sig-30", ts: 30 }))
			);
		});

		const cached = queryClient.getQueryData<SpaceHistorySnapshot>(
			spaceQueryKeys.history(
				"space-123",
				"11111111-1111-1111-1111-111111111111"
			)
		);
		expect(cached?.envelopes).toHaveLength(30);
		expect(cached?.envelopes[0]?.id).toBe("sig-1");
		expect(cached?.envelopes.at(-1)?.id).toBe("sig-30");
	});

	it("routes Center Agent stream frames into one conversation projection instead of the durable timeline", async () => {
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			window.setTimeout(() => callback(Date.now()), 0)
		);
		vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
			window.clearTimeout(handle);
		});
		const { view } = renderFeed();
		await openLatestSocket();

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "space.agent_stream_delta",
					v: 1,
					spaceId: "space-123",
					streamId: "stream:submission-1",
					sequence: 3,
					profileId: "agt_33333333-3333-4333-8333-333333333333",
					triggerMessageId: "signal-trigger-1",
					dispatchId: "dispatch-1",
					textSnapshot: "Accumulated reply",
					state: "streaming",
					updatedAtMs: 1_713_996_000_000,
				})
			);
			await vi.advanceTimersByTimeAsync(1);
		});

		expect(view.result.current.timelineEnvelopes).toEqual([]);
		expect(view.result.current.agentStreamProjections).toEqual([
			expect.objectContaining({
				sequence: 3,
				streamId: "stream:submission-1",
				text: "Accumulated reply",
			}),
		]);
	});

	it("tears down and reconnects when no inbound frame arrives within the deadline after a PING", async () => {
		renderFeed();
		await openLatestSocket();

		const firstSocket = FakeWebSocket.latest;

		// Drive past the deadline (~45s) with no inbound frame. The keepalive
		// interval fires PINGs along the way; once a PING has gone out and the
		// inbound silence exceeds the deadline, the watchdog tears the socket
		// down.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(70_000);
		});

		expect(firstSocket.sentFrames).toContain(SPACE_STREAM_KEEPALIVE_PING);
		expect(firstSocket.closeCount).toBeGreaterThanOrEqual(1);
		// A reconnect attempt rebuilds the socket.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
		});
		expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
	});

	it("does not tear down a quiet but healthy stream that keeps answering PONG", async () => {
		renderFeed();
		await openLatestSocket();

		const socket = FakeWebSocket.latest;

		// Simulate a quiet Space: only the forwarded keepalive PONG comes back,
		// no business signal. Each PING must draw a PONG that refreshes the
		// watchdog. This is the regression guard for the proxy swallowing PONG.
		for (let elapsed = 0; elapsed < 120_000; elapsed += 20_000) {
			await act(async () => {
				await vi.advanceTimersByTimeAsync(20_000);
				await FakeWebSocket.latest.emitMessage(SPACE_STREAM_KEEPALIVE_PONG);
			});
		}

		expect(socket.closeCount).toBe(0);
		// No reconnect was triggered: the original socket is still the only one.
		expect(FakeWebSocket.instances).toHaveLength(1);
	});

	it("does not tear down when business signals keep arriving inside the deadline", async () => {
		renderFeed();
		await openLatestSocket();

		const socket = FakeWebSocket.latest;

		for (let index = 0; index < 5; index += 1) {
			await act(async () => {
				await vi.advanceTimersByTimeAsync(20_000);
				await FakeWebSocket.latest.emitMessage(
					createTextSignalFrame(`sig-${index}`)
				);
			});
		}

		expect(socket.closeCount).toBe(0);
		expect(FakeWebSocket.instances).toHaveLength(1);
	});

	it("refreshes readiness caches from live agent readiness invalidations", async () => {
		const onAgentReadinessInvalidated = vi.fn(async () => undefined);
		const { membersRefetch, statusRefetch } = renderFeed({
			onAgentReadinessInvalidated,
		});
		await openLatestSocket();

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "agent.readiness.invalidated",
					spaceId: "space-123",
					version: 1,
					agentProfileIds: ["agt-1"],
					reason: "daemon.session.registered",
				})
			);
		});
		await flushMicrotasks();

		expect(onAgentReadinessInvalidated).toHaveBeenCalledWith({
			agentProfileIds: ["agt-1"],
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});
		expect(statusRefetch).toHaveBeenCalledTimes(1);
		expect(membersRefetch).toHaveBeenCalledTimes(1);
	});

	it("refetches members from a space.members.changed frame regardless of query staleness", async () => {
		// Guards the SWR cache widening (SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS /
		// SPACE_BOOTSTRAP_GC_TIME_MS): convergence inside the stale window is
		// owned by this imperative frame -> refetch path, which must never be
		// gated on react-query staleness.
		const { membersRefetch, statusRefetch } = renderFeed();
		await openLatestSocket();

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "space.members.changed",
					spaceId: "space-123",
					version: 7,
				})
			);
		});
		await flushMicrotasks();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});
		expect(statusRefetch).toHaveBeenCalledTimes(1);
		expect(membersRefetch).toHaveBeenCalledTimes(1);
	});

	it("refreshes Space identity without refetching members after metadata changes", async () => {
		const { membersRefetch, queryClient, statusRefetch } = renderFeed();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		await openLatestSocket();

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "space.meta.changed",
					spaceId: "space-123",
					version: 8,
					reason: "space.name.updated",
				})
			);
		});
		await flushMicrotasks();

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: accountSpaceQueryKeys.all,
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});
		expect(statusRefetch).toHaveBeenCalledTimes(1);
		expect(membersRefetch).not.toHaveBeenCalled();
	});
});

describe("useSpaceLandingFeed conversation reconcile", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
		FakeWebSocket.reset();
		readSpaceUpdatesMock.mockReset();
		readSpaceUpdatesMock.mockResolvedValue({ signals: [] });
		readSpaceHistoryMock.mockReset();
		readSpaceHistoryMock.mockResolvedValue({ envelopes: [], nextCursor: null });
		emitVisibilityChange("visible");
	});

	afterEach(() => {
		cleanup();
		FakeWebSocket.reset();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("reconciles cached history on mount before the live socket opens", async () => {
		readSpaceUpdatesMock.mockResolvedValue({
			signals: [createTextSignal({ id: "sig-2", ts: 20 })],
		});
		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});

		await flushMicrotasks();

		expect(readSpaceUpdatesMock).toHaveBeenCalledWith(
			expect.objectContaining({ afterSignalId: "sig-1" })
		);
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1", "sig-2"]);
	});

	it("does not mount-reconcile when cold history becomes ready later", async () => {
		const { view } = renderFeed({
			history: createPendingFeedHistory(),
		});

		act(() => {
			view.rerender({
				history: createReadyFeedHistory([
					createTextSignal({ id: "sig-1", ts: 10 }),
				]),
			});
		});
		await flushMicrotasks();

		expect(readSpaceUpdatesMock).not.toHaveBeenCalled();
		expect(readSpaceHistoryMock).not.toHaveBeenCalled();
	});

	it("waits for a speculative reconcile before running the mandatory post-acceptance read", async () => {
		const speculativeUpdates = createDeferred<{ signals: SignalEnvelope[] }>();
		readSpaceUpdatesMock
			.mockReturnValueOnce(speculativeUpdates.promise)
			.mockResolvedValueOnce({ signals: [] });
		renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});
		await flushMicrotasks();

		await openLatestTransport();
		await acceptLatestLiveSession();

		expect(readSpaceUpdatesMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			speculativeUpdates.resolve({ signals: [] });
			await speculativeUpdates.promise;
		});
		await flushMicrotasks();

		expect(readSpaceUpdatesMock).toHaveBeenCalledTimes(2);
	});

	it("closes the durable tail gap after Core accepts the live subscription", async () => {
		readSpaceUpdatesMock
			.mockResolvedValueOnce({ signals: [] })
			.mockResolvedValueOnce({
				signals: [createTextSignal({ id: "sig-2", ts: 20 })],
			});
		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});
		await flushMicrotasks();

		expect(readSpaceUpdatesMock).toHaveBeenCalledTimes(1);
		await openLatestTransport();
		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "system.hello.ack",
					profile: {
						kind: "human",
						profileId: "11111111-1111-1111-1111-111111111111",
					},
				})
			);
		});
		await flushMicrotasks();

		expect(readSpaceUpdatesMock).toHaveBeenCalledTimes(2);
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1", "sig-2"]);
	});

	it("runs a trailing reconcile when a newer socket attempt supersedes the inflight", async () => {
		const firstUpdates = createDeferred<{ signals: SignalEnvelope[] }>();
		readSpaceUpdatesMock
			.mockReturnValueOnce(firstUpdates.promise)
			.mockResolvedValueOnce({ signals: [] });
		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});
		await flushMicrotasks();

		act(() => {
			view.result.current.reconnectNow();
		});
		await flushMicrotasks();
		await openLatestSocket();

		firstUpdates.resolve({ signals: [] });
		await flushMicrotasks();

		expect(readSpaceUpdatesMock).toHaveBeenCalledTimes(2);
		expect(readSpaceUpdatesMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ afterSignalId: "sig-1" })
		);
	});

	it("catches up after the latest persisted signal id on reconnect", async () => {
		readSpaceUpdatesMock.mockResolvedValue({
			signals: [createTextSignal({ id: "sig-2", ts: 20 })],
		});
		const { queryClient, view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});

		await openLatestSocket();

		// reconcile resolved the anchor from the latest persisted (visible) signal
		// id, NOT a read-cursor timestamp.
		expect(readSpaceUpdatesMock).toHaveBeenCalledWith(
			expect.objectContaining({ afterSignalId: "sig-1" })
		);
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1", "sig-2"]);
		expect(
			queryClient
				.getQueryData<SpaceHistorySnapshot>(
					spaceQueryKeys.history(
						"space-123",
						"11111111-1111-1111-1111-111111111111"
					)
				)
				?.envelopes.map((signal) => signal.id)
		).toEqual(["sig-1", "sig-2"]);
	});

	it("keeps newer persisted signals when an older history snapshot arrives later", () => {
		const oldSnapshot = createReadyFeedHistory([
			createTextSignal({ id: "sig-1", ts: 10 }),
		]);
		const { view } = renderFeed({ history: oldSnapshot });

		act(() => {
			view.result.current.mergePersistedIncoming([
				createTextSignal({ id: "sig-2", ts: 20 }),
			]);
		});
		act(() => {
			view.rerender({
				history: createReadyFeedHistory([
					createTextSignal({ id: "sig-1", ts: 10 }),
				]),
			});
		});

		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1", "sig-2"]);
	});

	it("reconciles after history becomes ready when open skipped the first catch-up", async () => {
		readSpaceUpdatesMock.mockResolvedValue({
			signals: [createTextSignal({ id: "sig-2", ts: 20 })],
		});
		const { view } = renderFeed({
			history: createPendingFeedHistory(),
		});

		await openLatestSocket();

		expect(readSpaceUpdatesMock).not.toHaveBeenCalled();
		expect(readSpaceHistoryMock).not.toHaveBeenCalled();

		act(() => {
			view.rerender({
				history: createReadyFeedHistory([
					createTextSignal({ id: "sig-1", ts: 10 }),
				]),
			});
		});
		await flushMicrotasks();

		expect(readSpaceUpdatesMock).toHaveBeenCalledWith(
			expect.objectContaining({ afterSignalId: "sig-1" })
		);
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1", "sig-2"]);
	});

	it("drains multi-page catch-up from the starting anchor even when live tail arrives", async () => {
		const firstPage = createSignals({ count: 50, startIndex: 1 });
		const secondPage = createSignals({ count: 49, startIndex: 51 });
		readSpaceUpdatesMock
			.mockImplementationOnce(async () => {
				await Promise.resolve();
				await FakeWebSocket.latest.emitMessage(
					JSON.stringify(
						createTextSignal({
							id: "sig-100",
							text: "Live tail",
							ts: 100,
						})
					)
				);
				return { signals: firstPage };
			})
			.mockResolvedValueOnce({ signals: secondPage })
			.mockResolvedValueOnce({ signals: [] });

		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-0", ts: 0 })],
		});

		await openLatestSocket();

		expect(readSpaceUpdatesMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ afterSignalId: "sig-0" })
		);
		expect(readSpaceUpdatesMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ afterSignalId: "sig-50" })
		);
		expect(readSpaceUpdatesMock).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ afterSignalId: "sig-100" })
		);
		const ids = view.result.current.timelineEnvelopes.map(
			(signal) => signal.id
		);
		expect(ids).toContain("sig-51");
		expect(ids).toContain("sig-99");
		expect(ids).toContain("sig-100");
		expect(ids).toHaveLength(101);
	});

	it("reconciles on visibilitychange -> visible without going through onOpen", async () => {
		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});

		await openLatestSocket();
		// Ignore the open-time reconcile; this test asserts the refocus path.
		readSpaceUpdatesMock.mockClear();
		readSpaceUpdatesMock.mockResolvedValue({
			signals: [createTextSignal({ id: "sig-2", ts: 20 })],
		});

		act(() => {
			emitVisibilityChange("visible");
		});
		await flushMicrotasks();

		// reconcile ran from the visibility handler — no new socket was opened to
		// reach it (the refocus reconcile is decoupled from the socket open path).
		expect(readSpaceUpdatesMock).toHaveBeenCalledWith(
			expect.objectContaining({ afterSignalId: "sig-1" })
		);
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toContain("sig-2");
	});

	it("falls back to a recent-window reload on a stale anchor without looping reconnect", async () => {
		readSpaceUpdatesMock.mockRejectedValue({
			upstreamCode: "space.updates.anchor_not_found",
			status: 404,
			message: "update anchor signal not found",
		});
		readSpaceHistoryMock.mockResolvedValue({
			envelopes: [
				createTextSignal({ id: "sig-1", ts: 10 }),
				createTextSignal({ id: "sig-9", ts: 90 }),
			],
			nextCursor: null,
		});

		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});

		const firstSocket = FakeWebSocket.latest;
		await openLatestSocket();

		// Stale anchor heals via the recent-window reload (deduped by id), and the
		// socket is NOT torn down — a missing anchor must never spin the reconnect
		// loop.
		expect(readSpaceHistoryMock).toHaveBeenCalledWith(
			expect.objectContaining({ spaceId: "space-123" })
		);
		expect(firstSocket.closeCount).toBe(0);
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(view.result.current.liveState).toBe("connected");
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1", "sig-9"]);
	});

	it("marks reconcile stale without falling back when a non-anchor catch-up failure occurs", async () => {
		readSpaceUpdatesMock.mockRejectedValue({
			status: 500,
			message: "upstream boom",
		});
		readSpaceHistoryMock.mockResolvedValue({
			envelopes: [
				createTextSignal({ id: "sig-1", ts: 10 }),
				createTextSignal({ id: "sig-2", ts: 20 }),
			],
			nextCursor: null,
		});

		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});

		const firstSocket = FakeWebSocket.latest;
		await openLatestSocket();

		expect(readSpaceHistoryMock).not.toHaveBeenCalled();
		expect(firstSocket.closeCount).toBe(0);
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(view.result.current.liveState).toBe("stale");
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1"]);
	});

	it("retries a failed speculative catch-up from the original anchor after ready", async () => {
		readSpaceUpdatesMock
			.mockRejectedValueOnce({
				status: 500,
				message: "upstream boom",
			})
			.mockResolvedValueOnce({
				signals: [createTextSignal({ id: "sig-2", ts: 20 })],
			});

		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});

		await openLatestSocket();

		expect(readSpaceUpdatesMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ afterSignalId: "sig-1" })
		);
		expect(view.result.current.liveState).toBe("connected");
		const ids = view.result.current.timelineEnvelopes.map(
			(signal) => signal.id
		);
		expect(ids).toContain("sig-2");
	});

	it("dedupes by signal id so a reconciled duplicate is not rendered twice", async () => {
		// The catch-up window re-delivers the anchor itself plus one genuinely new
		// signal; the merge keys by id, so the anchor is not duplicated.
		readSpaceUpdatesMock.mockResolvedValue({
			signals: [
				createTextSignal({ id: "sig-1", ts: 10 }),
				createTextSignal({ id: "sig-2", ts: 20 }),
			],
		});

		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});

		await openLatestSocket();

		const ids = view.result.current.timelineEnvelopes.map(
			(signal) => signal.id
		);
		expect(ids).toEqual(["sig-1", "sig-2"]);
		expect(ids.filter((id) => id === "sig-1")).toHaveLength(1);
	});

	it("reconciles from a recent-window reload when nothing is persisted yet", async () => {
		readSpaceHistoryMock.mockResolvedValue({
			envelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
			nextCursor: null,
		});

		const { view } = renderFeed();
		await openLatestSocket();

		// With no persisted anchor, reconcile cannot do an incremental read and
		// must re-bootstrap from the recent window instead.
		expect(readSpaceUpdatesMock).not.toHaveBeenCalled();
		expect(readSpaceHistoryMock).toHaveBeenCalledWith(
			expect.objectContaining({ spaceId: "space-123" })
		);
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1"]);
	});

	it("never reads or writes the read cursor while reconciling", async () => {
		// Force the stale-anchor fallback too, so both reconcile paths are
		// exercised; neither may touch SpaceCursor.lastSeenTs.
		readSpaceUpdatesMock.mockRejectedValue({
			upstreamCode: "space.updates.anchor_not_found",
			status: 404,
			message: "update anchor signal not found",
		});
		readSpaceHistoryMock.mockResolvedValue({
			envelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
			nextCursor: null,
		});

		renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});
		await openLatestSocket();

		act(() => {
			emitVisibilityChange("visible");
		});
		await flushMicrotasks();

		expect(readSpaceCursorLastSeenTsMock).not.toHaveBeenCalled();
		expect(writeSpaceCursorLastSeenTsMock).not.toHaveBeenCalled();
	});

	it("drops reconcile results after unmount without refetch timers", async () => {
		const deferred = createDeferred<{ signals: SignalEnvelope[] }>();
		readSpaceUpdatesMock.mockReturnValue(deferred.promise);
		const { membersRefetch, statusRefetch, view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});

		act(() => {
			FakeWebSocket.latest.emitOpen().catch(() => undefined);
		});
		await flushMicrotasks();
		view.unmount();
		await act(async () => {
			deferred.resolve({
				signals: [createTextSignal({ id: "sig-2", ts: 20 })],
			});
			await deferred.promise;
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});

		expect(membersRefetch).not.toHaveBeenCalled();
		expect(statusRefetch).not.toHaveBeenCalled();
	});

	it("drops reconcile results after a newer reconnect supersedes the request", async () => {
		const deferred = createDeferred<{ signals: SignalEnvelope[] }>();
		readSpaceUpdatesMock.mockReturnValue(deferred.promise);
		const { membersRefetch, statusRefetch, view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});

		act(() => {
			FakeWebSocket.latest.emitOpen().catch(() => undefined);
		});
		await flushMicrotasks();

		act(() => {
			view.result.current.reconnectNow();
		});
		await flushMicrotasks();

		await act(async () => {
			deferred.resolve({
				signals: [createTextSignal({ id: "sig-2", ts: 20 })],
			});
			await deferred.promise;
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});

		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1"]);
		expect(membersRefetch).not.toHaveBeenCalled();
		expect(statusRefetch).not.toHaveBeenCalled();
	});
});
