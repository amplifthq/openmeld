import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import {
	SPACE_STREAM_KEEPALIVE_PING,
	SPACE_STREAM_KEEPALIVE_PONG,
} from "@openmeld/protocol";
import type {
	DesktopSpaceStreamBridge,
	DesktopSpaceStreamEvent,
} from "@openmeld/schemas";
import { listSpaceThreadSignalsResponseSchema } from "@openmeld/schemas";
import type {
	SignalEnvelope,
	SpaceAgentStreamDeltaFrame,
	SpaceAgentStreamSnapshot,
	SpaceInboxUnreadTarget,
} from "@openmeld/schemas/types";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { type ReactNode, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeAgentReadinessInvalidations } from "#/lib/agents/agent-readiness-invalidation-bus";
import { readRecentReactUpdates } from "#/lib/observability/react-update-trace";
import type { AccountSpaceSections } from "#/lib/spaces/account-spaces";
import { agentExecutionReadinessQueryKeys } from "#/query/agents/execution-readiness";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	readSpaceCursorLastSeenTs,
	writeSpaceCursorLastSeenTs,
} from "#/query/spaces/cursor";
import {
	readSpaceHistory,
	readSpaceUpdates,
	type SpaceHistorySnapshot,
	spaceHistoryQueryOptions,
} from "#/query/spaces/history";
import { MissingHistoryAnchorError } from "#/query/spaces/retry";
import { spaceFileQueryKeys } from "#/query/spaces/space-files";
import { spaceTaskQueryKeys } from "#/query/spaces/space-tasks";
import { spaceQueryKeys } from "#/query/spaces/status";
import { spaceThreadSignalsQueryOptions } from "#/query/spaces/threads";
import threadReconnectFixture from "./fixtures/thread-reconnect.json";
import {
	SpaceWakeProgressVisibleProjectionProvider,
	usePublishSpaceWakeProgressVisibleProjection,
} from "./space-wake-progress-visible-projection";
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

	async emitAccessRevoked() {
		await this.emit("close", { code: 1008, reason: "space_access_changed" });
	}

	async emitClose(code: number, reason: string) {
		await this.emit("close", { code, reason });
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
		participationEnabled?: boolean;
		seededEnvelopes?: readonly SignalEnvelope[];
		unreadTargets?: readonly SpaceInboxUnreadTarget[];
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
				confirmedCursor: initialHistory.data.confirmedCursor,
				nextCursor: null,
			}
		);
	}
	const view = renderHook(
		(props: {
			history: FeedHistoryState;
			participationEnabled?: boolean;
			unreadTargets?: readonly SpaceInboxUnreadTarget[];
		}) =>
			useSpaceLandingFeed({
				spaceId: "space-123",
				openMeldProfileId: "11111111-1111-1111-1111-111111111111",
				participationEnabled:
					props.participationEnabled ?? options.participationEnabled ?? true,
				statusReady: true,
				statusRefetch,
				membersRefetch,
				initialAgentStreams: options.initialAgentStreams ?? [],
				unreadTargets: props.unreadTargets,
				readinessScope: { organizationId: "org-1", storageScope: "account-1" },
				history: props.history,
			}),
		{
			initialProps: {
				history: initialHistory,
				participationEnabled: options.participationEnabled,
				unreadTargets: options.unreadTargets,
			} as {
				history: FeedHistoryState;
				participationEnabled?: boolean;
				unreadTargets?: readonly SpaceInboxUnreadTarget[];
			},
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
		data: { envelopes, confirmedCursor: envelopes.at(-1)?.id ?? null },
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

	it("refreshes authority when Core closes a session after access changes", async () => {
		const { statusRefetch } = renderFeed();
		await openLatestSocket();
		await act(async () => FakeWebSocket.latest.emitAccessRevoked());
		expect(statusRefetch).toHaveBeenCalledTimes(1);
	});

	it("refreshes authority when Core closes a session it could not verify", async () => {
		const { statusRefetch } = renderFeed();
		await openLatestSocket();
		await act(async () =>
			FakeWebSocket.latest.emitClose(1013, "space_access_unverified")
		);
		// Do not wait for an accepted reconnect: a revoked viewer never gets one.
		expect(statusRefetch).toHaveBeenCalledTimes(1);
	});

	it("refreshes authority from the Desktop native close metadata", () => {
		let deliver: ((event: DesktopSpaceStreamEvent) => void) | undefined;
		const open = vi.fn().mockResolvedValue(undefined);
		const bridge: DesktopSpaceStreamBridge = {
			spaceStreamOpen: open,
			spaceStreamPing: vi.fn().mockResolvedValue(undefined),
			spaceStreamClose: vi.fn().mockResolvedValue(undefined),
			onSpaceStream: (listener) => {
				deliver = listener;
				return vi.fn();
			},
		};
		Object.defineProperty(window, "openmeldDesktop", {
			configurable: true,
			value: bridge,
		});
		try {
			const { statusRefetch } = renderFeed();
			const subscription = open.mock.calls[0]?.[0];
			if (!(subscription && deliver)) {
				throw new Error("Expected a native subscription");
			}
			act(() => {
				deliver?.({ id: subscription.id, type: "open" });
				deliver?.({
					id: subscription.id,
					type: "message",
					data: JSON.stringify({
						type: "system.hello.ack",
						profile: {
							kind: "human",
							profileId: "11111111-1111-1111-1111-111111111111",
						},
					}),
				});
				deliver?.({
					id: subscription.id,
					type: "close",
					code: 1008,
					reason: "space_access_changed",
				});
			});

			expect(statusRefetch).toHaveBeenCalledTimes(1);
		} finally {
			Reflect.deleteProperty(window, "openmeldDesktop");
		}
	});

	it("does not report the Space live before Core accepts the subscription", async () => {
		const { view } = renderFeed();
		await openLatestTransport();

		expect(view.result.current.liveState).toBe("connecting");

		await acceptLatestLiveSession();

		expect(view.result.current.liveState).toBe("connected");
	});

	it("does not open a participating live session until the Human viewer is a member", () => {
		const { view } = renderFeed({ participationEnabled: false });

		expect(FakeWebSocket.instances).toHaveLength(0);
		expect(view.result.current.liveState).toBe("connected");

		act(() => {
			view.rerender({
				history: createReadyFeedHistory(),
				participationEnabled: true,
			});
		});

		expect(FakeWebSocket.instances).toHaveLength(1);
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
		const accountSpaces: AccountSpaceSections = {
			pinnedItems: [
				{
					spaceId: "space-123",
					spaceName: "Product planning",
					organizationId: "org-1",
					openProfileId: "11111111-1111-1111-1111-111111111111",
					openProfileName: "Mira",
					visibility: "private",
					spacePurpose: null,
					lastJoinedAt: "2026-09-23T00:00:00.000Z",
					joinedProfiles: [],
					pinnedAt: null,
					pinnedProfileIds: [],
					activeAgentCount: null,
					activeHumanCount: null,
					activeMemberCount: null,
				},
			],
			spaceItems: [],
		};
		queryClient.setQueryData(
			accountSpaceQueryKeys.items(
				"11111111-1111-1111-1111-111111111111",
				"account"
			),
			accountSpaces
		);
		await openLatestSocket();

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(SPACE_STREAM_KEEPALIVE_PONG);
			await FakeWebSocket.latest.emitMessage(createTextSignalFrame("sig-1"));
		});
		await flushMicrotasks();

		expect(view.result.current.timelineEnvelopes).toHaveLength(1);
		expect(view.result.current.timelineEnvelopes[0]?.id).toBe("sig-1");
		expect(
			queryClient.getQueryData<AccountSpaceSections>(
				accountSpaceQueryKeys.items(
					"11111111-1111-1111-1111-111111111111",
					"account"
				)
			)?.pinnedItems[0]?.messagePreview?.text
		).toBe("Hello from the stream");
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

	it("retains small live messages beyond the initial 30-message page", async () => {
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
		expect(cached?.envelopes).toHaveLength(31);
		expect(cached?.envelopes[0]?.id).toBe("sig-0");
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
			await vi.advanceTimersByTimeAsync(90_000);
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

	it("probes after a suspended page resumes without discarding received thinking", async () => {
		const { view } = renderFeed();
		await openLatestSocket();
		const socket = FakeWebSocket.latest;
		await act(async () => {
			await socket.emitMessage(
				JSON.stringify({
					type: "space.agent_stream_delta",
					v: 1,
					spaceId: "space-123",
					streamId: "stream:submission-1",
					profileId: "agt_33333333-3333-4333-8333-333333333333",
					triggerMessageId: "signal-trigger-1",
					dispatchId: "dispatch-1",
					kind: "thinking",
					thinkingSnapshot: "Already received work",
					sequence: 1,
					state: "streaming",
					updatedAtMs: Date.now(),
				} satisfies SpaceAgentStreamDeltaFrame)
			);
			await vi.advanceTimersByTimeAsync(100);
		});
		// Move wall time without running timers: the browser was suspended.
		vi.setSystemTime(Date.now() + 120_000);
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
			await vi.advanceTimersByTimeAsync(20_000);
			await socket.emitMessage(SPACE_STREAM_KEEPALIVE_PONG);
		});
		expect(socket.closeCount).toBe(0);
		expect(view.result.current.agentStreamProjections[0]).toHaveProperty(
			"thinking",
			"Already received work"
		);
		await act(async () => {
			socket.close();
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(view.result.current.agentStreamProjections[0]).toHaveProperty(
			"thinking",
			"Already received work"
		);
		await act(async () => {
			await FakeWebSocket.latest.emitAccessRevoked();
		});
		expect(view.result.current.agentStreamProjections[0]).not.toHaveProperty(
			"thinking"
		);
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
		vi.stubGlobal("BroadcastChannel", undefined);
		const onAgentReadinessInvalidated = vi.fn();
		const unsubscribe = subscribeAgentReadinessInvalidations(
			onAgentReadinessInvalidated,
			{ organizationId: "org-1", storageScope: "account-1" }
		);
		const { membersRefetch, queryClient, statusRefetch } = renderFeed();
		const entryKey = ["spaces", "entry-resolution", "space-123", "human-1"];
		queryClient.setQueryData(entryKey, { view: { state: "allowed" } });
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

		expect(onAgentReadinessInvalidated).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfileIds: ["agt-1"],
			})
		);
		unsubscribe();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});
		expect(statusRefetch).toHaveBeenCalledTimes(1);
		expect(membersRefetch).toHaveBeenCalledTimes(1);
		expect(queryClient.getQueryState(entryKey)?.isInvalidated).toBe(false);
	});

	it("bounds member event bursts and follows a slow read with one fresh read", async () => {
		const { membersRefetch } = renderFeed();
		await openLatestSocket();
		let release!: () => void;
		membersRefetch.mockImplementationOnce(
			() =>
				new Promise<undefined>((resolve) => {
					release = () => resolve(undefined);
				})
		);
		const emit = async (version: number) =>
			FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "space.members.changed",
					spaceId: "space-123",
					version,
				})
			);
		await act(async () => {
			await emit(1);
			await vi.advanceTimersByTimeAsync(200);
			await emit(2);
			await vi.advanceTimersByTimeAsync(100);
		});
		expect(membersRefetch).toHaveBeenCalledTimes(1);
		await act(async () => {
			await emit(3);
			await emit(4);
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(membersRefetch).toHaveBeenCalledTimes(1);
		await act(async () => {
			release();
			await flushMicrotasks();
			await vi.advanceTimersByTimeAsync(300);
		});
		expect(membersRefetch).toHaveBeenCalledTimes(2);
	});

	it("refetches members from a space.members.changed frame regardless of query staleness", async () => {
		// Guards the SWR cache widening (SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS /
		// SPACE_BOOTSTRAP_GC_TIME_MS): convergence inside the stale window is
		// owned by this imperative frame -> refetch path, which must never be
		// gated on react-query staleness.
		const { membersRefetch, queryClient, statusRefetch } = renderFeed();
		const entryKey = ["spaces", "entry-resolution", "space-123", "human-1"];
		queryClient.setQueryData(entryKey, { view: { state: "allowed" } });
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
		expect(queryClient.getQueryState(entryKey)?.isInvalidated).toBe(true);
	});

	it("refreshes Space identity without refetching members after metadata changes", async () => {
		const { membersRefetch, queryClient, statusRefetch } = renderFeed();
		const sessionsKey = [
			"center-agent",
			"org-1",
			"human-1",
			"sessions",
			"sidebar",
		];
		queryClient.setQueryData(sessionsKey, { pages: [] });
		// A generated MemberAgent Session title must reach the chat title too.
		const memberAgentSessionsKey = [
			"agent-direct-message-sessions",
			"org-1",
			"agent-1",
			"active",
		];
		queryClient.setQueryData(memberAgentSessionsKey, { sessions: [] });
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
		expect(queryClient.getQueryState(sessionsKey)?.isInvalidated).toBe(true);
		expect(
			queryClient.getQueryState(memberAgentSessionsKey)?.isInvalidated
		).toBe(true);
	});

	it("refreshes only Agent requests when a request in the Space opens or closes", async () => {
		const { membersRefetch, queryClient, statusRefetch } = renderFeed();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		await openLatestSocket();

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "space.meta.changed",
					spaceId: "space-123",
					version: 8,
					reason: "space.agent_access.changed",
				})
			);
		});
		await flushMicrotasks();

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["agent-access"],
		});
		expect(invalidateQueries).not.toHaveBeenCalledWith({
			queryKey: accountSpaceQueryKeys.all,
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});
		expect(statusRefetch).not.toHaveBeenCalled();
		expect(membersRefetch).not.toHaveBeenCalled();
	});

	it("refreshes Agent requests when an Agent joins", async () => {
		const { queryClient } = renderFeed();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		await openLatestSocket();

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "space.members.changed",
					spaceId: "space-123",
					version: 8,
					profileIds: ["agt_felix"],
					reason: "space.members.added",
				})
			);
		});
		await flushMicrotasks();

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["agent-access"],
		});
	});

	it("refreshes Space Files without refetching members after file changes", async () => {
		const { membersRefetch, queryClient, statusRefetch } = renderFeed();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		await openLatestSocket();

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "space.files.changed",
					spaceId: "space-123",
					version: 9,
					reason: "space_file.content_committed",
				})
			);
		});
		await flushMicrotasks();

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: spaceFileQueryKeys.space("space-123"),
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});
		expect(statusRefetch).toHaveBeenCalledTimes(1);
		expect(membersRefetch).not.toHaveBeenCalled();
	});

	it("refreshes authoritative Wake progress without unrelated Space reads", async () => {
		const { membersRefetch, queryClient, statusRefetch } = renderFeed();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		await openLatestSocket();

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "wake.progress.changed",
					spaceId: "space-123",
					version: 10,
					agentProfileIds: ["agt-1"],
					clientMessageIds: ["client-message-1"],
					reason: "runtime_coordinator.wake_progress_changed",
				})
			);
		});
		await flushMicrotasks();

		expect(invalidateQueries).toHaveBeenCalledWith(
			{
				queryKey: spaceQueryKeys.activeWakeProgressSummary(
					"space-123",
					"11111111-1111-1111-1111-111111111111"
				),
				refetchType: "active",
			},
			{ cancelRefetch: false }
		);
		expect(statusRefetch).not.toHaveBeenCalled();
		expect(membersRefetch).not.toHaveBeenCalled();
	});

	it("re-reads the active Wake progress summary after a first read still in flight when a reconnect is accepted", async () => {
		const { queryClient } = renderFeed();
		await openLatestSocket();
		let resolveFirstRead!: (value: string) => void;
		const readSummary = vi
			.fn<() => Promise<string>>()
			.mockImplementationOnce(
				() =>
					new Promise<string>((resolve) => {
						resolveFirstRead = resolve;
					})
			)
			.mockResolvedValue("summary-v2");
		const mounted = renderHook(
			() =>
				useQuery({
					queryKey: spaceQueryKeys.activeWakeProgressSummary(
						"space-123",
						"11111111-1111-1111-1111-111111111111"
					),
					queryFn: readSummary,
					staleTime: Number.POSITIVE_INFINITY,
				}),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<QueryClientProvider client={queryClient}>
						{children}
					</QueryClientProvider>
				),
			}
		);
		await flushMicrotasks();
		expect(readSummary).toHaveBeenCalledTimes(1);

		// The first summary read started before a withheld approval change.
		await act(async () => {
			await FakeWebSocket.latest.emitClose(1013, "space_access_unverified");
			await vi.advanceTimersByTimeAsync(2000);
		});
		await openLatestSocket();
		await act(async () => {
			resolveFirstRead("summary-v1");
			await vi.advanceTimersByTimeAsync(0);
		});
		await flushMicrotasks();
		await act(async () => vi.advanceTimersByTimeAsync(0));

		// The approval tray must not keep the read that predates the change.
		expect(readSummary).toHaveBeenCalledTimes(2);
		expect(mounted.result.current.data).toBe("summary-v2");
	});

	it("coalesces Wake progress and delegation details behind a slow refresh and keeps one final refresh", async () => {
		const { queryClient } = renderFeed();
		await openLatestSocket();
		await flushMicrotasks();
		let finishFirstRefresh: (() => void) | undefined;
		const firstRefresh = new Promise<void>((resolve) => {
			finishFirstRefresh = resolve;
		});
		const invalidateQueries = vi
			.spyOn(queryClient, "invalidateQueries")
			.mockImplementationOnce(() => firstRefresh)
			.mockResolvedValue(undefined);

		for (const version of [10, 11, 12]) {
			await act(async () => {
				await FakeWebSocket.latest.emitMessage(
					JSON.stringify({
						type: "wake.progress.changed",
						spaceId: "space-123",
						version,
						agentProfileIds: ["agt-1"],
						clientMessageIds: [`client-message-${version}`],
						reason: "runtime_coordinator.wake_progress_changed",
					})
				);
			});
		}
		await flushMicrotasks();

		expect(invalidateQueries).toHaveBeenCalledTimes(2);
		await act(async () => {
			finishFirstRefresh?.();
			await firstRefresh;
		});
		await flushMicrotasks();

		expect(invalidateQueries).toHaveBeenCalledTimes(4);
		expect(invalidateQueries).toHaveBeenLastCalledWith(
			{
				queryKey: ["spaces", "message-details", "space-123"],
				refetchType: "active",
			},
			{ cancelRefetch: false }
		);

		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify({
					type: "wake.progress.changed",
					spaceId: "another-space",
					version: 99,
					agentProfileIds: ["agt-1"],
					clientMessageIds: ["client-message-other-space"],
					reason: "runtime_coordinator.wake_progress_changed",
				})
			);
		});
		await flushMicrotasks();

		expect(invalidateQueries).toHaveBeenCalledTimes(4);
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

	it("does not repeatedly update when equivalent history gets a new wrapper", () => {
		const envelopes = [createTextSignal({ id: "sig-1", ts: 10 })];
		const queryClient = new QueryClient();
		const statusRefetch = vi.fn(async () => undefined);
		const membersRefetch = vi.fn(async () => undefined);
		const initialAgentStreams: readonly SpaceAgentStreamSnapshot[] = [];
		const readinessScope = {
			organizationId: "org-1",
			storageScope: "account-1",
		};
		let renders = 0;

		const view = renderHook(
			() => {
				if (++renders > 10) {
					throw new Error("Equivalent history caused repeated renders");
				}
				return useSpaceLandingFeed({
					spaceId: "space-123",
					openMeldProfileId: "11111111-1111-1111-1111-111111111111",
					participationEnabled: false,
					statusReady: true,
					statusRefetch,
					membersRefetch,
					initialAgentStreams,
					readinessScope,
					history: createReadyFeedHistory(envelopes),
				});
			},
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<QueryClientProvider client={queryClient}>
						{children}
					</QueryClientProvider>
				),
			}
		);

		expect(view.result.current.timelineEnvelopes).toEqual(envelopes);
	});

	it("seeds the timeline from cached history on the first render", () => {
		const envelopes = [
			createTextSignal({ id: "sig-1", ts: 10 }),
			createTextSignal({ id: "sig-2", ts: 20 }),
		];
		const queryClient = new QueryClient();
		const statusRefetch = vi.fn(async () => undefined);
		const membersRefetch = vi.fn(async () => undefined);
		const initialAgentStreams: readonly SpaceAgentStreamSnapshot[] = [];
		const readinessScope = {
			organizationId: "org-1",
			storageScope: "account-1",
		};
		const history = createReadyFeedHistory(envelopes);
		const renderedTimelines: (readonly SignalEnvelope[])[] = [];

		const view = renderHook(
			() => {
				const feed = useSpaceLandingFeed({
					spaceId: "space-123",
					openMeldProfileId: "11111111-1111-1111-1111-111111111111",
					participationEnabled: false,
					statusReady: true,
					statusRefetch,
					membersRefetch,
					initialAgentStreams,
					readinessScope,
					history,
				});
				renderedTimelines.push(feed.timelineEnvelopes);
				return feed;
			},
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<QueryClientProvider client={queryClient}>
						{children}
					</QueryClientProvider>
				),
			}
		);

		// A cached Space switch must never commit an empty conversation first.
		expect(renderedTimelines[0]?.map((signal) => signal.id)).toEqual([
			"sig-1",
			"sig-2",
		]);
		expect(renderedTimelines.every((timeline) => timeline.length === 2)).toBe(
			true
		);
		// The mount-time merge finds nothing new, so the state is written once.
		expect(new Set(renderedTimelines).size).toBe(1);
		expect(view.result.current.timelineEnvelopes).toBe(renderedTimelines[0]);
	});

	it("starts empty and fills the timeline when history arrives after mount", () => {
		const envelopes = [createTextSignal({ id: "sig-1", ts: 10 })];
		const { view } = renderFeed({
			history: createPendingFeedHistory(),
			participationEnabled: false,
		});
		expect(view.result.current.timelineEnvelopes).toEqual([]);
		view.rerender({
			history: createReadyFeedHistory(envelopes),
			participationEnabled: false,
		});
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1"]);
	});

	it("settles a subscribed history refresh when equal-revision agent details change", async () => {
		const queryClient = new QueryClient();
		const options = spaceHistoryQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "11111111-1111-1111-1111-111111111111",
			enabled: false,
		});
		const signal = createTextSignal({ id: "sig-1", ts: 10 });
		const before: SignalEnvelope = {
			...signal,
			profile: {
				...signal.profile,
				kind: "agent",
				agentControllerRef: "codex",
			},
		};
		const refreshed: SignalEnvelope = {
			...before,
			profile: { ...before.profile, agentControllerRef: "claude-code" },
		};
		queryClient.setQueryData(options.queryKey, {
			envelopes: [before],
			nextCursor: null,
		});
		const refetch = vi.fn(async () => undefined);
		const initialAgentStreams: readonly SpaceAgentStreamSnapshot[] = [];
		const readinessScope = {
			organizationId: "org-1",
			storageScope: "account-1",
		};
		const view = renderHook(
			() => {
				const history = useQuery(options);
				const feed = useSpaceLandingFeed({
					spaceId: "space-123",
					openMeldProfileId: "11111111-1111-1111-1111-111111111111",
					participationEnabled: false,
					statusReady: false,
					statusRefetch: refetch,
					membersRefetch: refetch,
					initialAgentStreams,
					readinessScope,
					history: {
						data: history.data,
						isPending: history.isPending,
						isSuccess: history.isSuccess,
						isError: history.isError,
					},
				});
				// The controller republishes derived Wake items when the timeline changes,
				// including when no Wake is visible. Keep that real feedback edge here.
				// biome-ignore lint/correctness/useExhaustiveDependencies: Preserve the controller's timeline-dependent projection in this reduced regression.
				const visibleWakeItems = useMemo(() => [], [feed.timelineEnvelopes]);
				usePublishSpaceWakeProgressVisibleProjection(visibleWakeItems, {
					profileId: "11111111-1111-1111-1111-111111111111",
					spaceId: "space-123",
				});
				return feed;
			},
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<QueryClientProvider client={queryClient}>
						<SpaceWakeProgressVisibleProjectionProvider
							profileId="11111111-1111-1111-1111-111111111111"
							spaceId="space-123"
						>
							{children}
						</SpaceWakeProgressVisibleProjectionProvider>
					</QueryClientProvider>
				),
			}
		);
		await act(async () => {
			queryClient.setQueryData(options.queryKey, {
				envelopes: [refreshed],
				nextCursor: null,
			});
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(view.result.current.timelineEnvelopes).toEqual([refreshed]);
		expect(
			queryClient.getQueryData<SpaceHistorySnapshot>(options.queryKey)
				?.envelopes
		).toEqual([refreshed]);
		const updateLabels = readRecentReactUpdates()
			.slice(-10)
			.map(({ event }) => event);
		expect(updateLabels).toContain("space_timeline_agent_controller_changed");
		expect(updateLabels).toContain("space_timeline_write");
		expect(updateLabels).toContain("space_wake_visible_publish");
		view.unmount();
		queryClient.clear();
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

	it("does not let a live frame create the first history anchor before bootstrap", async () => {
		const { queryClient, view } = renderFeed({
			history: createPendingFeedHistory(),
		});
		await openLatestSocket();
		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify(createTextSignal({ id: "sig-3", ts: 30 }))
			);
		});
		const key = spaceQueryKeys.history(
			"space-123",
			"11111111-1111-1111-1111-111111111111"
		);
		expect(queryClient.getQueryData(key)).toBeUndefined();
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-3"]);

		act(() => {
			view.rerender({
				history: createReadyFeedHistory([
					createTextSignal({ id: "sig-1", ts: 10 }),
				]),
			});
		});
		expect(
			queryClient
				.getQueryData<SpaceHistorySnapshot>(key)
				?.envelopes.map((signal) => signal.id)
		).toEqual(["sig-1", "sig-3"]);
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
			view.result.current.retryLiveUpdates();
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

	it.each([
		new MissingHistoryAnchorError(),
		new OpenMeldApiClientHttpError({
			code: "upstream_error",
			status: 403,
			rawBody: "",
			message: "Forbidden",
		}),
	])("recovers only transient failed active history windows after the Space reconnects (%s)", async (permanentError) => {
		const { queryClient } = renderFeed();
		await openLatestSocket();
		let reachable = false;
		const read = vi.fn(() => {
			if (!reachable) {
				return Promise.reject(new TypeError("Failed to fetch"));
			}
			return Promise.resolve("restored");
		});
		const readyRead = vi.fn(async () => "already readable");
		const permanentRead = vi.fn(() => Promise.reject(permanentError));
		const windows = renderHook(
			() => ({
				permanent: useQuery({
					queryKey: [
						...spaceQueryKeys.historyWindow(
							"space-123",
							"11111111-1111-1111-1111-111111111111"
						),
						"permanent",
					],
					queryFn: permanentRead,
					retry: false,
				}),
				current: useQuery({
					queryKey: [
						...spaceQueryKeys.historyWindow(
							"space-123",
							"11111111-1111-1111-1111-111111111111"
						),
						"failed",
					],
					queryFn: read,
					retry: false,
				}),
				other: useQuery({
					queryKey: spaceQueryKeys.historyWindow(
						"space-123",
						"22222222-2222-2222-2222-222222222222"
					),
					queryFn: read,
					retry: false,
				}),
				ready: useQuery({
					queryKey: [
						...spaceQueryKeys.historyWindow(
							"space-123",
							"11111111-1111-1111-1111-111111111111"
						),
						"ready",
					],
					queryFn: readyRead,
					staleTime: Number.POSITIVE_INFINITY,
				}),
			}),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<QueryClientProvider client={queryClient}>
						{children}
					</QueryClientProvider>
				),
			}
		);
		await flushMicrotasks();
		await act(async () => vi.advanceTimersByTimeAsync(0));
		expect(windows.result.current.current.isError).toBe(true);
		reachable = true;
		await act(async () => {
			FakeWebSocket.latest.close();
			await vi.advanceTimersByTimeAsync(2000);
		});
		await openLatestSocket();
		await flushMicrotasks();
		await act(async () => vi.advanceTimersByTimeAsync(0));
		expect(windows.result.current.current.data).toBe("restored");
		expect(windows.result.current.other.isError).toBe(true);
		expect(readyRead).toHaveBeenCalledOnce();
		expect(permanentRead).toHaveBeenCalledOnce();
	});

	it("cancels in-flight status and member reads before the reconnect refetch", async () => {
		const { membersRefetch, queryClient, statusRefetch } = renderFeed();
		await openLatestSocket();
		const cancelled: string[] = [];
		const cancelQueries = queryClient.cancelQueries.bind(queryClient);
		vi.spyOn(queryClient, "cancelQueries").mockImplementation(
			(filters, options) => {
				const key = filters?.queryKey;
				if (key?.[0] === "spaces" && key[1] === "status") {
					cancelled.push("status");
				}
				if (key?.[0] === "spaces" && key[1] === "members") {
					cancelled.push("members");
				}
				return cancelQueries(filters, options);
			}
		);
		const refetchedAfterCancel: string[] = [];
		statusRefetch.mockImplementation(() => {
			refetchedAfterCancel.push(
				cancelled.includes("status") ? "status:cancelled" : "status:shared"
			);
			return Promise.resolve(undefined);
		});
		membersRefetch.mockImplementation(() => {
			refetchedAfterCancel.push(
				cancelled.includes("members") ? "members:cancelled" : "members:shared"
			);
			return Promise.resolve(undefined);
		});

		await act(async () => {
			await FakeWebSocket.latest.emitClose(1013, "space_access_unverified");
			await vi.advanceTimersByTimeAsync(2000);
		});
		refetchedAfterCancel.length = 0;
		await openLatestSocket();
		await flushMicrotasks();
		await act(async () => vi.advanceTimersByTimeAsync(1000));

		// A first status read may predate the withheld change; it must not be
		// shared by the reconnect refetch.
		expect(refetchedAfterCancel).toEqual(
			expect.arrayContaining(["status:cancelled", "members:cancelled"])
		);
		expect(refetchedAfterCancel).not.toContain("status:shared");
		expect(refetchedAfterCancel).not.toContain("members:shared");
	});

	it.each([
		["Tasks", spaceTaskQueryKeys.space("space-123")],
		["message pins", ["space-message-pins", "space-123"]],
		["file pins", ["space-file-pins", "space-123"]],
	] as const)("replaces a %s first load still in flight when a reconnect is accepted", async (_name, queryKey) => {
		const { queryClient } = renderFeed();
		await openLatestSocket();
		let resolveFirstRead!: (value: string) => void;
		const readTasks = vi
			.fn<() => Promise<string>>()
			.mockImplementationOnce(
				() =>
					new Promise<string>((resolve) => {
						resolveFirstRead = resolve;
					})
			)
			.mockResolvedValue("tasks-v2");
		const mounted = renderHook(
			() =>
				useQuery({
					queryKey,
					queryFn: readTasks,
					staleTime: Number.POSITIVE_INFINITY,
				}),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<QueryClientProvider client={queryClient}>
						{children}
					</QueryClientProvider>
				),
			}
		);
		await flushMicrotasks();
		expect(readTasks).toHaveBeenCalledTimes(1);

		// The first read started before the withheld change and has no data yet.
		await act(async () => {
			await FakeWebSocket.latest.emitClose(1013, "space_access_unverified");
			await vi.advanceTimersByTimeAsync(2000);
		});
		await openLatestSocket();
		await act(async () => {
			resolveFirstRead("tasks-v1");
			await vi.advanceTimersByTimeAsync(0);
		});
		await flushMicrotasks();
		await act(async () => vi.advanceTimersByTimeAsync(0));

		expect(readTasks).toHaveBeenCalledTimes(2);
		expect(mounted.result.current.data).toBe("tasks-v2");
	});

	it("re-reads mounted Tasks, files, readiness, and chat titles after an accepted reconnect", async () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const onAgentReadinessInvalidated = vi.fn();
		const unsubscribeReadiness = subscribeAgentReadinessInvalidations(
			onAgentReadinessInvalidated,
			{ organizationId: "org-1", storageScope: "account-1" }
		);
		const { queryClient } = renderFeed();
		await openLatestSocket();
		let version = 1;
		const readTasks = vi.fn(async () => `tasks-v${version}`);
		const readFiles = vi.fn(async () => `files-v${version}`);
		const readReadiness = vi.fn(async () => `readiness-v${version}`);
		const readChatTitles = vi.fn(async () => `titles-v${version}`);
		const mounted = renderHook(
			() => ({
				chatTitles: useQuery({
					queryKey: ["center-agent", "org-1", "account-1", "sessions"],
					queryFn: readChatTitles,
					staleTime: Number.POSITIVE_INFINITY,
				}),
				files: useQuery({
					queryKey: spaceFileQueryKeys.space("space-123"),
					queryFn: readFiles,
					staleTime: Number.POSITIVE_INFINITY,
				}),
				readiness: useQuery({
					queryKey: [
						...agentExecutionReadinessQueryKeys.batchesForOrganization(
							"account-1",
							"org-1"
						),
						"agt-1",
					],
					queryFn: readReadiness,
					staleTime: Number.POSITIVE_INFINITY,
				}),
				tasks: useQuery({
					queryKey: spaceTaskQueryKeys.space("space-123"),
					queryFn: readTasks,
					staleTime: Number.POSITIVE_INFINITY,
				}),
			}),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<QueryClientProvider client={queryClient}>
						{children}
					</QueryClientProvider>
				),
			}
		);
		await flushMicrotasks();
		await act(async () => vi.advanceTimersByTimeAsync(0));
		expect(mounted.result.current.tasks.data).toBe("tasks-v1");
		expect(mounted.result.current.files.data).toBe("files-v1");

		// Core withheld an invalidation while it could not verify access, then
		// closed the socket; the snapshots changed in the meantime.
		version = 2;
		await act(async () => {
			await FakeWebSocket.latest.emitClose(1013, "space_access_unverified");
			await vi.advanceTimersByTimeAsync(2000);
		});
		await openLatestSocket();
		await flushMicrotasks();
		await act(async () => vi.advanceTimersByTimeAsync(0));

		expect(mounted.result.current.tasks.data).toBe("tasks-v2");
		expect(mounted.result.current.files.data).toBe("files-v2");
		expect(readTasks).toHaveBeenCalledTimes(2);
		expect(readFiles).toHaveBeenCalledTimes(2);
		// The withheld frame's Agent Profile IDs and rename reason are gone, so
		// the reconnect refreshes these projections broadly.
		expect(mounted.result.current.readiness.data).toBe("readiness-v2");
		expect(mounted.result.current.chatTitles.data).toBe("titles-v2");
		expect(readReadiness).toHaveBeenCalledTimes(2);
		expect(readChatTitles).toHaveBeenCalledTimes(2);
		// Other tabs learn about readiness only through the shared bus.
		expect(onAgentReadinessInvalidated).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfileIds: [],
				reason: "space.live.reconnected",
				refreshAll: true,
				spaceId: "space-123",
			})
		);
		unsubscribeReadiness();
	});

	it.each([
		"reconnect",
		"refocus",
		"periodic",
	])("refreshes only requested Thread recovery (%s)", async (trigger) => {
		// Captured from a real Web Thread read. Synthetic names and text are
		// condensed; native continuation identity and response shape are retained.
		const snapshot = listSpaceThreadSignalsResponseSchema.parse(
			threadReconnectFixture
		);
		const before = {
			...snapshot,
			signals: snapshot.signals.slice(0, 1),
			placements: snapshot.placements.slice(0, 1),
		};
		const { queryClient } = renderFeed();
		await openLatestSocket();
		const options = spaceThreadSignalsQueryOptions({
			spaceId: "space-123",
			threadId: snapshot.placements[0].threadId,
			openMeldProfileId: "11111111-1111-1111-1111-111111111111",
			enabled: true,
		});
		const otherOptions = spaceThreadSignalsQueryOptions({
			spaceId: "space-123",
			threadId: snapshot.placements[0].threadId,
			openMeldProfileId: "22222222-2222-2222-2222-222222222222",
			enabled: true,
		});
		queryClient.setQueryData(options.queryKey, before);
		queryClient.setQueryData(otherOptions.queryKey, before);
		const threads = renderHook(
			() => ({
				current: useQuery({
					...options,
					staleTime: Number.POSITIVE_INFINITY,
					queryFn: async () => snapshot,
				}),
				other: useQuery({
					...otherOptions,
					staleTime: Number.POSITIVE_INFINITY,
					queryFn: async () => snapshot,
				}),
			}),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<QueryClientProvider client={queryClient}>
						{children}
					</QueryClientProvider>
				),
			}
		);
		if (trigger === "reconnect") {
			await act(async () => {
				FakeWebSocket.latest.close();
				await vi.advanceTimersByTimeAsync(2000);
			});
			await openLatestSocket();
		} else if (trigger === "refocus") {
			act(() => emitVisibilityChange("visible"));
		} else {
			// Keep the live stream healthy through the main-feed reconcile timer.
			for (let step = 0; step < 5; step += 1) {
				await act(async () => {
					await FakeWebSocket.latest.emitMessage(SPACE_STREAM_KEEPALIVE_PONG);
					await vi.advanceTimersByTimeAsync(18_000);
				});
			}
		}
		await flushMicrotasks();
		await act(async () => vi.advanceTimersByTimeAsync(0));
		const ids = (value: typeof snapshot | undefined) =>
			value?.signals.map((signal) => signal.id);
		expect(ids(threads.result.current.current.data)).toEqual(
			ids(trigger === "periodic" ? before : snapshot)
		);
		expect(ids(threads.result.current.other.data)).toEqual(ids(before));
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
			expect.objectContaining({ afterSignalId: "sig-99" })
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

	it("does not skip a missed message when a newer live frame arrives first", async () => {
		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});
		await openLatestSocket();
		readSpaceUpdatesMock.mockClear();
		readSpaceUpdatesMock.mockImplementation(async ({ afterSignalId }) => ({
			signals:
				afterSignalId === "sig-1"
					? [
							createTextSignal({ id: "sig-2", ts: 20 }),
							createTextSignal({ id: "sig-3", ts: 30 }),
						]
					: [],
		}));
		await act(async () => {
			await FakeWebSocket.latest.emitMessage(
				JSON.stringify(createTextSignal({ id: "sig-3", ts: 30 }))
			);
		});
		act(() => emitVisibilityChange("visible"));
		await flushMicrotasks();

		expect(readSpaceUpdatesMock).toHaveBeenCalledWith(
			expect.objectContaining({ afterSignalId: "sig-1" })
		);
		expect(
			view.result.current.timelineEnvelopes.map((signal) => signal.id)
		).toEqual(["sig-1", "sig-2", "sig-3"]);
	});

	it("reads the Space tail when Inbox reports an unseen message", async () => {
		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});
		await openLatestSocket();
		readSpaceUpdatesMock.mockClear();
		readSpaceUpdatesMock.mockResolvedValue({
			signals: [createTextSignal({ id: "sig-2", ts: 20 })],
		});
		act(() => {
			view.rerender({
				history: createReadyFeedHistory([
					createTextSignal({ id: "sig-1", ts: 10 }),
				]),
				unreadTargets: [
					{ signalId: "sig-2", occurredAtMs: 20, threadRootSignalId: null },
				],
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

		const { view, queryClient } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "stale-tail", ts: 100 })],
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
		).toEqual(["sig-1", "sig-9", "stale-tail"]);
		const saved = queryClient.getQueryData<SpaceHistorySnapshot>(
			spaceQueryKeys.history(
				"space-123",
				"11111111-1111-1111-1111-111111111111"
			)
		);
		expect(saved?.confirmedCursor).toBe("sig-9");
		view.unmount();
		readSpaceUpdatesMock.mockReset().mockResolvedValue({ signals: [] });
		readSpaceHistoryMock.mockClear();
		renderFeed({
			history: {
				isPending: false,
				isSuccess: true,
				isError: false,
				data: saved,
			},
		});
		await openLatestSocket();
		expect(readSpaceUpdatesMock).toHaveBeenCalledWith(
			expect.objectContaining({ afterSignalId: "sig-9" })
		);
		expect(readSpaceHistoryMock).not.toHaveBeenCalled();
	});

	it("keeps recovery interrupted until catch-up succeeds after reconnect", async () => {
		const { view } = renderFeed({
			seededEnvelopes: [createTextSignal({ id: "sig-1", ts: 10 })],
		});
		await openLatestSocket();
		const catchUp = createDeferred<{ signals: SignalEnvelope[] }>();
		readSpaceUpdatesMock.mockReturnValue(catchUp.promise);
		act(() => FakeWebSocket.latest.close());
		expect(view.result.current.liveState).toBe("degraded");
		await act(async () => vi.advanceTimersByTimeAsync(1000));
		await openLatestSocket();
		expect(view.result.current.liveState).toBe("stale");
		catchUp.reject({ status: 500, message: "upstream boom" });
		await flushMicrotasks();
		expect(view.result.current.liveState).toBe("stale");
		readSpaceUpdatesMock.mockResolvedValue({ signals: [] });
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		await flushMicrotasks();
		expect(view.result.current.liveState).toBe("connected");
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
			view.result.current.retryLiveUpdates();
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
