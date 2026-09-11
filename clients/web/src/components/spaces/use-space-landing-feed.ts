import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import {
	SPACE_STREAM_KEEPALIVE_PING,
	SPACE_STREAM_KEEPALIVE_PONG,
} from "@openmeld/protocol";
import {
	AGENT_REPLY_FINAL_PURPOSE,
	CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
} from "@openmeld/schemas";
import type {
	SignalEnvelope,
	SpaceAgentStreamPresence,
	SpaceAgentStreamSnapshot,
	SpaceThreadContext,
	SpaceThreadSignalPlacement,
} from "@openmeld/schemas/types";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { publishAgentReadinessInvalidationFrame } from "#/lib/agents/agent-readiness-invalidation-bus";
import {
	createSpaceLiveStreamUrl,
	parseSpaceLiveMessage,
	type SpaceLiveMessage,
} from "#/lib/spaces/live-stream";
import {
	isSpaceTimelineCatchUpAnchorSignal,
	mergeSpaceTimelineEnvelopes,
	type SpaceLiveState,
} from "#/lib/spaces/timeline";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	readSpaceHistory,
	SPACE_UPDATES_LIMIT,
	writeSpaceHistoryEnvelopesToCache,
} from "#/query/spaces/history";
import {
	fetchSpaceUpdatesAfterSubscription,
	spaceUpdatesQueryOptions,
} from "#/query/spaces/history-sync";
import { spaceFileQueryKeys } from "#/query/spaces/space-files";
import { spaceQueryKeys } from "#/query/spaces/status";
import { messageReactionsKey } from "./space-message-reactions";
import { useSpaceConversation } from "./use-space-conversation";

const LIVE_RECONNECT_STATUS =
	"Live updates paused. Reconnecting automatically...";
const LIVE_RECONCILE_STALE_STATUS =
	"Live updates couldn't check for missed messages. Retrying automatically...";
const LIVE_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000] as const;
// Grace window before a dropped stream is surfaced as "degraded". A blip that
// reconnects within this window never flips the UI, killing the flash-on-every-
// blip noise; only a sustained disconnect escalates to the visible status.
const LIVE_DEGRADE_GRACE_MS = 2500;
// Sub-idle cadence for the live-stream keepalive PING (the Space DO answers
// PONG via setWebSocketAutoResponse) so the proxy-held connection chain never
// goes idle and gets evicted — idle eviction surfaced as periodic Reconnecting.
const SPACE_STREAM_KEEPALIVE_INTERVAL_MS = 20_000;
// Inbound-liveness deadline for the pong-watchdog. If we have sent a keepalive
// PING but no transport frame (signal, PONG, or ack) has arrived within this
// window, the socket is treated as half-open and proactively torn down so the
// reconnect path can rebuild a real connection. Sized at ~2x the PING cadence
// so a single dropped/late PONG never trips it. The check compares wall-clock
// timestamps inside the keepalive interval rather than arming a standalone
// countdown timer, because a backgrounded tab throttles timers — a coalesced
// late tick stays correct against elapsed time instead of firing a stale
// deadline early (Socket.IO #5135 class of bug).
const WATCHDOG_DEADLINE_MS = 45_000;
const VISIBLE_RECONCILE_INTERVAL_MS = 90_000;
const MAX_RECONCILE_UPDATE_PAGES = 50;

type MutableRef<T> = {
	current: T;
};

type ReconcileSignals = (incoming: readonly SignalEnvelope[]) => boolean;

type ReconcileFlight = {
	feedIdentity: string;
	promise: Promise<void>;
	reconnectKey: number;
};

type MountHistoryAnchor = {
	feedIdentity: string;
	signalId: string | null;
};

type ReconcileFreshnessControls = {
	afterSubscription: boolean;
	queryClient: ReturnType<typeof useQueryClient>;
	applyReconciledSignals: ReconcileSignals;
	openMeldProfileId: string;
	isCurrentReconcile: () => boolean;
	markReconcileHealthy: () => void;
	markReconcileStale: () => void;
	pendingCatchUpCursorRef: MutableRef<string | null>;
	spaceId: string;
};

async function reconcileFromRecentWindow(
	input: ReconcileFreshnessControls
): Promise<void> {
	try {
		const snapshot = await readSpaceHistory({
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
		});
		if (input.applyReconciledSignals(snapshot.envelopes)) {
			input.pendingCatchUpCursorRef.current = null;
			input.markReconcileHealthy();
		}
	} catch (error) {
		if (!input.isCurrentReconcile()) {
			return;
		}
		console.warn("[openmeld.web.space.live_recent_window_reconcile_failed]", {
			error: toStructuredApiClientFailure(error).message,
			spaceId: input.spaceId,
		});
		input.markReconcileStale();
	}
}

async function drainSpaceUpdatesFromAnchor(
	input: ReconcileFreshnessControls & {
		anchorSignalId: string;
	}
): Promise<void> {
	let cursor = input.anchorSignalId;
	for (
		let pageCount = 0;
		pageCount < MAX_RECONCILE_UPDATE_PAGES;
		pageCount += 1
	) {
		const page = {
			spaceId: input.spaceId,
			afterSignalId: cursor,
			openMeldProfileId: input.openMeldProfileId,
		};
		const updates = input.afterSubscription
			? await fetchSpaceUpdatesAfterSubscription(input.queryClient, page)
			: await input.queryClient.fetchQuery(spaceUpdatesQueryOptions(page));
		if (!input.isCurrentReconcile()) {
			return;
		}
		if (updates.signals.length === 0) {
			input.pendingCatchUpCursorRef.current = null;
			input.markReconcileHealthy();
			return;
		}
		if (!input.applyReconciledSignals(updates.signals)) {
			return;
		}
		const nextCursor = updates.signals.at(-1)?.id ?? null;
		if (!nextCursor || nextCursor === cursor) {
			console.warn("[openmeld.web.space.live_tail_catchup_stalled]", {
				afterSignalId: cursor,
				spaceId: input.spaceId,
			});
			input.pendingCatchUpCursorRef.current = cursor;
			input.markReconcileStale();
			return;
		}
		cursor = nextCursor;
		input.pendingCatchUpCursorRef.current = cursor;
		if (updates.signals.length < SPACE_UPDATES_LIMIT) {
			input.pendingCatchUpCursorRef.current = null;
			input.markReconcileHealthy();
			return;
		}
	}

	console.warn("[openmeld.web.space.live_tail_catchup_page_limit_reached]", {
		afterSignalId: cursor,
		pageLimit: MAX_RECONCILE_UPDATE_PAGES,
		spaceId: input.spaceId,
	});
	input.markReconcileStale();
}

export function useSpaceLandingFeed(input: {
	spaceId: string;
	openMeldProfileId: string;
	participationEnabled: boolean;
	statusReady: boolean;
	statusRefetch: () => Promise<unknown>;
	membersRefetch: () => Promise<unknown>;
	initialAgentStreamPresences?: readonly SpaceAgentStreamPresence[];
	initialAgentStreams: readonly SpaceAgentStreamSnapshot[];
	onThreadSignal?: (input: {
		placement: SpaceThreadSignalPlacement;
		signal: SignalEnvelope;
		threadContext: SpaceThreadContext;
	}) => void;
	onWakeFinalOutcomeFactsRefresh?: (input: {
		agentProfileIds: readonly string[];
		signalIds: readonly string[];
	}) => Promise<void> | void;
	readinessScope?: { organizationId?: string | null; storageScope: string };
	history: {
		isPending: boolean;
		isSuccess: boolean;
		isError: boolean;
		data?: {
			envelopes: readonly SignalEnvelope[];
		};
	};
}) {
	const queryClient = useQueryClient();
	const readinessOrganizationId = input.readinessScope?.organizationId ?? "";
	const readinessStorageScope = input.readinessScope?.storageScope ?? "";
	const [timelineEnvelopes, setTimelineEnvelopes] = useState<
		readonly SignalEnvelope[]
	>([]);
	const [liveState, setLiveState] = useState<SpaceLiveState>("connecting");
	const [liveErrorMessage, setLiveErrorMessage] = useState<string | null>(null);
	const [reconnectKey, setReconnectKey] = useState(0);
	const feedIdentity = `${input.spaceId}::${input.openMeldProfileId}`;
	// Capture only the history available on entry. A later cold-cache bootstrap is
	// already the authoritative recent window and must not be mistaken for a
	// reason to issue an extra mount-time catch-up request.
	const mountHistoryAnchorRef = useRef<MountHistoryAnchor>({
		feedIdentity,
		signalId:
			!input.history.isPending && input.history.isSuccess
				? getLatestSignalEnvelopeId(input.history.data?.envelopes ?? [])
				: null,
	});
	const { agentStreamProjections, handleAgentStreamFrame } =
		useSpaceConversation({
			initialAgentStreamPresences: input.initialAgentStreamPresences ?? [],
			initialAgentStreams: input.initialAgentStreams,
			liveConnectionEpoch: reconnectKey,
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
		});

	const statusRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null
	);
	const membersRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null
	);
	const liveInvalidationVersionByTypeRef = useRef(new Map<string, number>());
	const wakeProgressRefreshScopeRef = useRef<WakeProgressRefreshScope | null>(
		null
	);
	const wakeFinalOutcomeRefreshTimerRef = useRef<ReturnType<
		typeof setTimeout
	> | null>(null);
	const observedWakeFinalOutcomeSignalIdsRef = useRef(new Set<string>());
	const pendingWakeFinalOutcomeRefreshRef =
		useRef<WakeFinalOutcomeRefreshBatch>({
			agentProfileIds: new Set(),
			signalIds: new Set(),
		});
	const timelineEnvelopesRef = useRef<readonly SignalEnvelope[]>([]);
	const persistedTimelineEnvelopesRef = useRef<readonly SignalEnvelope[]>([]);
	const onThreadSignalRef = useRef(input.onThreadSignal);
	const onWakeFinalOutcomeFactsRefreshRef = useRef(
		input.onWakeFinalOutcomeFactsRefresh
	);
	const reconnectKeyRef = useRef(0);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectAttemptCountRef = useRef(0);
	const degradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const liveStateRef = useRef<SpaceLiveState>("connecting");
	const mountedRef = useRef(false);
	// Wall-clock timestamp of the last inbound transport frame on the live
	// socket (any business signal, the keepalive PONG, or an ack — all are
	// proof the chain is still delivering). Seeded on open and read by the
	// pong-watchdog; null means nothing has arrived on the current socket yet.
	const lastInboundFrameTsRef = useRef<number | null>(null);
	// Whether the initial history seed has landed. The socket now connects on
	// mount (in parallel with bootstrap), so onOpen must know if the timeline
	// anchor exists yet without re-running the connection effect when it does.
	const historyReadyRef = useRef(false);
	const currentSocketAttemptKeyRef = useRef<string | null>(null);
	const readySocketAttemptKeyRef = useRef<string | null>(null);
	const skippedReadyReconcilePendingRef = useRef(false);
	// Identity of the conversation the feed is currently bound to. reconcile is
	// async and can be invoked from contexts without a per-socket disposed flag
	// (visibilitychange), so it captures this value before awaiting and discards
	// its result if the feed has since switched Spaces/profiles — a late reconcile
	// must never merge a prior conversation's signals into the reset refs.
	const feedIdentityRef = useRef(feedIdentity);
	const reconcileFlightRef = useRef<ReconcileFlight | null>(null);
	const mountReconcileStartedIdentityRef = useRef<string | null>(null);
	const pendingCatchUpCursorRef = useRef<string | null>(null);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		const identityChanged = feedIdentityRef.current !== feedIdentity;
		feedIdentityRef.current = feedIdentity;
		if (!identityChanged) {
			return;
		}
		mountHistoryAnchorRef.current = {
			feedIdentity,
			signalId:
				!input.history.isPending && input.history.isSuccess
					? getLatestSignalEnvelopeId(input.history.data?.envelopes ?? [])
					: null,
		};
		mountReconcileStartedIdentityRef.current = null;
	}, [
		feedIdentity,
		input.history.data,
		input.history.isPending,
		input.history.isSuccess,
	]);

	const membersRefetchRef = useRef(input.membersRefetch);
	const statusRefetchRef = useRef(input.statusRefetch);

	useEffect(() => {
		membersRefetchRef.current = input.membersRefetch;
	}, [input.membersRefetch]);

	useEffect(() => {
		statusRefetchRef.current = input.statusRefetch;
	}, [input.statusRefetch]);

	useEffect(() => {
		timelineEnvelopesRef.current = timelineEnvelopes;
	}, [timelineEnvelopes]);

	useEffect(() => {
		liveStateRef.current = liveState;
	}, [liveState]);

	const advanceReconnectKey = useCallback(() => {
		const nextReconnectKey = reconnectKeyRef.current + 1;
		reconnectKeyRef.current = nextReconnectKey;
		setReconnectKey(nextReconnectKey);
	}, []);

	// Force an immediate reconnect: reset the backoff and re-run the connection
	// effect with a fresh socket. Used on tab-refocus and the manual retry control
	// so a dropped stream never sits waiting out a (possibly throttled) timer.
	const reconnectNow = useCallback(() => {
		if (!input.participationEnabled) {
			return;
		}
		clearReconnectTimer(reconnectTimerRef);
		clearReconnectTimer(degradeTimerRef);
		reconnectAttemptCountRef.current = 0;
		advanceReconnectKey();
	}, [advanceReconnectKey, input.participationEnabled]);

	// Reconcile the conversation against the durable store: pull everything after
	// the latest persisted visible signal and merge it (deduped by signal id) into
	// the timeline. This is the correctness layer — the live socket is best-effort,
	// so any gap (missed frame, half-open window, backgrounded tab) is closed by
	// re-reading from SQL. Decoupled from the socket lifecycle so it can run from
	// any trigger (reconnect open, tab refocus).
	//
	// Best-effort and never throws: every failure path (stale anchor, transient
	// read error) is caught and logged, and the timeline keeps whatever it already
	// had. Callers never tear the socket down on a reconcile failure — socket health
	// is owned by onError / onClose / the watchdog — so reconcile can never spin a
	// reconnect → catch-up-fails → reconnect loop. A stale anchor is recovered by
	// falling back to a recent-window reload rather than re-presenting the dead
	// anchor.
	const reconcileConversationOnce = useCallback(
		async (afterSubscription = false): Promise<void> => {
			const startIdentity = feedIdentityRef.current;
			const startReconnectKey = reconnectKeyRef.current;
			const isCurrentReconcile = (): boolean =>
				mountedRef.current &&
				feedIdentityRef.current === startIdentity &&
				reconnectKeyRef.current === startReconnectKey;
			const markReconcileHealthy = (): void => {
				if (!isCurrentReconcile()) {
					return;
				}
				if (liveStateRef.current === "stale") {
					setLiveState("connected");
					setLiveErrorMessage(null);
				}
			};
			const markReconcileStale = (): void => {
				if (!isCurrentReconcile()) {
					return;
				}
				setLiveState("stale");
				setLiveErrorMessage(LIVE_RECONCILE_STALE_STATUS);
			};
			const applyReconciledSignals = (
				incoming: readonly SignalEnvelope[]
			): boolean => {
				if (!isCurrentReconcile()) {
					// The feed switched Spaces/profiles while this reconcile was in
					// flight, was unmounted, or a newer socket attempt superseded this
					// request. Dropping the result avoids stale refetch timers and
					// cross-conversation contamination.
					return false;
				}

				const newSignals = listNewSignals({
					current: timelineEnvelopesRef.current,
					incoming,
				});
				recordPersistedTimelineSignals({
					currentRef: persistedTimelineEnvelopesRef,
					incoming,
					queryClient,
					spaceId: input.spaceId,
					openMeldProfileId: input.openMeldProfileId,
				});
				mergeIncomingSignals({
					currentRef: timelineEnvelopesRef,
					incoming,
					setState: setTimelineEnvelopes,
				});
				scheduleRefetchesForSignals({
					wakeFinalOutcomeHandledByCallback: Boolean(
						onWakeFinalOutcomeFactsRefreshRef.current
					),
					membersRefetch: membersRefetchRef.current,
					membersRefetchTimerRef,
					signals: newSignals,
					statusRefetch: statusRefetchRef.current,
					statusRefetchTimerRef,
				});
				scheduleWakeFinalOutcomeFactsRefresh({
					onRefreshRef: onWakeFinalOutcomeFactsRefreshRef,
					observedSignalIdsRef: observedWakeFinalOutcomeSignalIdsRef,
					pendingRef: pendingWakeFinalOutcomeRefreshRef,
					signals: newSignals,
					spaceId: input.spaceId,
					timerRef: wakeFinalOutcomeRefreshTimerRef,
				});
				return true;
			};

			const reconcileControls: ReconcileFreshnessControls = {
				afterSubscription,
				queryClient,
				applyReconciledSignals,
				openMeldProfileId: input.openMeldProfileId,
				isCurrentReconcile,
				markReconcileHealthy,
				markReconcileStale,
				pendingCatchUpCursorRef,
				spaceId: input.spaceId,
			};

			const latestAnchorSignalId = getLatestSignalEnvelopeId(
				persistedTimelineEnvelopesRef.current
			);
			const anchorSignalId =
				pendingCatchUpCursorRef.current ?? latestAnchorSignalId;
			if (!anchorSignalId) {
				await reconcileFromRecentWindow(reconcileControls);
				return;
			}

			try {
				pendingCatchUpCursorRef.current = anchorSignalId;
				await drainSpaceUpdatesFromAnchor({
					...reconcileControls,
					anchorSignalId,
				});
			} catch (error) {
				if (!isCurrentReconcile()) {
					return;
				}
				const failure = toStructuredApiClientFailure(error);
				console.warn("[openmeld.web.space.live_tail_catchup_failed]", {
					anchorReaped: isAnchorNotFoundFailure(failure),
					error: failure.message,
					spaceId: input.spaceId,
				});
				if (isAnchorNotFoundFailure(failure)) {
					pendingCatchUpCursorRef.current = null;
					await reconcileFromRecentWindow(reconcileControls);
					return;
				}
				markReconcileStale();
			}
		},
		[input.openMeldProfileId, input.spaceId, queryClient]
	);

	// Serialize every reconcile trigger. Repeated triggers for the same socket
	// attempt share the active request; a newer attempt waits for that request to
	// settle, then runs its own catch-up against the new lifecycle generation.
	// Core's ready barrier can also require a trailing read in the same generation;
	// that read must never be satisfied by the speculative pre-ready flight.
	const reconcileConversation = useCallback(
		async (options?: { afterActiveFlight?: boolean }): Promise<void> => {
			const requestedFeedIdentity = feedIdentityRef.current;
			const runSerializedReconcile = async (
				afterActiveFlight: boolean
			): Promise<void> => {
				if (
					!mountedRef.current ||
					feedIdentityRef.current !== requestedFeedIdentity
				) {
					return;
				}

				const requestedReconnectKey = reconnectKeyRef.current;
				const activeFlight = reconcileFlightRef.current;
				if (activeFlight) {
					await activeFlight.promise;
					if (
						!afterActiveFlight &&
						activeFlight.feedIdentity === requestedFeedIdentity &&
						activeFlight.reconnectKey === requestedReconnectKey
					) {
						return;
					}
					await runSerializedReconcile(false);
					return;
				}

				const flight = {
					feedIdentity: requestedFeedIdentity,
					promise: reconcileConversationOnce(
						options?.afterActiveFlight === true
					),
					reconnectKey: requestedReconnectKey,
				};
				reconcileFlightRef.current = flight;
				const clearFlight = (): void => {
					if (reconcileFlightRef.current === flight) {
						reconcileFlightRef.current = null;
					}
				};
				await flight.promise.then(clearFlight, (error: unknown) => {
					clearFlight();
					throw error;
				});
			};
			await runSerializedReconcile(options?.afterActiveFlight === true);
		},
		[reconcileConversationOnce]
	);

	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") {
				return;
			}

			// The UI can believe it is live while the socket has silently gone
			// half-open, so reconcile unconditionally on refocus to close any gap —
			// independent of the visible liveState. Reconnect only as a follow-up
			// when the socket itself looks unhealthy (degraded, or no inbound frame
			// within the watchdog deadline), so a healthy tab is not needlessly torn
			// down. reconcile never rejects (it catches internally); the catch here
			// is a defensive backstop only.
			reconcileConversation().catch(() => undefined);

			const lastInboundFrameTs = lastInboundFrameTsRef.current;
			const isInboundStale =
				lastInboundFrameTs === null ||
				Date.now() - lastInboundFrameTs > WATCHDOG_DEADLINE_MS;
			if (liveStateRef.current === "degraded" || isInboundStale) {
				reconnectNow();
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () =>
			document.removeEventListener("visibilitychange", onVisibilityChange);
	}, [reconnectNow, reconcileConversation]);

	useEffect(() => {
		if (!input.statusReady || input.history.isPending) {
			return;
		}

		const timer = setInterval(() => {
			if (document.visibilityState !== "visible") {
				return;
			}
			reconcileConversation().catch(() => undefined);
		}, VISIBLE_RECONCILE_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [input.history.isPending, input.statusReady, reconcileConversation]);

	useEffect(() => {
		historyReadyRef.current =
			!input.history.isPending && input.history.isSuccess;
	}, [input.history.isPending, input.history.isSuccess]);

	useEffect(() => {
		onThreadSignalRef.current = input.onThreadSignal;
	}, [input.onThreadSignal]);

	useEffect(() => {
		onWakeFinalOutcomeFactsRefreshRef.current =
			input.onWakeFinalOutcomeFactsRefresh;
	}, [input.onWakeFinalOutcomeFactsRefresh]);

	useEffect(() => {
		if (input.spaceId.trim().length === 0) {
			return;
		}

		timelineEnvelopesRef.current = [];
		persistedTimelineEnvelopesRef.current = [];
		setTimelineEnvelopes([]);
		setLiveState("connecting");
		setLiveErrorMessage(null);
		reconnectKeyRef.current = 0;
		setReconnectKey(0);
		reconnectAttemptCountRef.current = 0;
		liveInvalidationVersionByTypeRef.current.clear();
		observedWakeFinalOutcomeSignalIdsRef.current.clear();
		pendingWakeFinalOutcomeRefreshRef.current.agentProfileIds.clear();
		pendingWakeFinalOutcomeRefreshRef.current.signalIds.clear();
		pendingCatchUpCursorRef.current = null;
		currentSocketAttemptKeyRef.current = null;
		readySocketAttemptKeyRef.current = null;
		skippedReadyReconcilePendingRef.current = false;
		lastInboundFrameTsRef.current = null;
		clearWakeFinalOutcomeRefreshTimer(wakeFinalOutcomeRefreshTimerRef);
		clearReconnectTimer(reconnectTimerRef);
		clearReconnectTimer(degradeTimerRef);
	}, [input.spaceId]);

	useEffect(() => {
		return () => {
			clearReconnectTimer(reconnectTimerRef);
			clearReconnectTimer(degradeTimerRef);
			if (statusRefetchTimerRef.current) {
				clearTimeout(statusRefetchTimerRef.current);
			}
			if (membersRefetchTimerRef.current) {
				clearTimeout(membersRefetchTimerRef.current);
			}
			clearWakeFinalOutcomeRefreshTimer(wakeFinalOutcomeRefreshTimerRef);
		};
	}, []);

	useEffect(() => {
		if (input.history.isPending || !input.history.isSuccess) {
			return;
		}

		const incoming = input.history.data?.envelopes ?? [];
		recordPersistedTimelineSignals({
			currentRef: persistedTimelineEnvelopesRef,
			incoming,
			queryClient,
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
		});
		const newSignals =
			timelineEnvelopesRef.current.length > 0
				? listNewSignals({
						current: timelineEnvelopesRef.current,
						incoming,
					})
				: [];
		mergeIncomingSignals({
			currentRef: timelineEnvelopesRef,
			incoming,
			setState: setTimelineEnvelopes,
		});
		if (input.statusReady) {
			scheduleRefetchesForSignals({
				wakeFinalOutcomeHandledByCallback: Boolean(
					onWakeFinalOutcomeFactsRefreshRef.current
				),
				membersRefetch: input.membersRefetch,
				membersRefetchTimerRef,
				signals: newSignals,
				statusRefetch: input.statusRefetch,
				statusRefetchTimerRef,
			});
			scheduleWakeFinalOutcomeFactsRefresh({
				onRefreshRef: onWakeFinalOutcomeFactsRefreshRef,
				observedSignalIdsRef: observedWakeFinalOutcomeSignalIdsRef,
				pendingRef: pendingWakeFinalOutcomeRefreshRef,
				signals: newSignals,
				spaceId: input.spaceId,
				timerRef: wakeFinalOutcomeRefreshTimerRef,
			});
		}
	}, [
		input.history.data,
		input.history.isPending,
		input.history.isSuccess,
		input.membersRefetch,
		input.spaceId,
		input.statusReady,
		input.statusRefetch,
		input.openMeldProfileId,
		queryClient,
	]);

	useEffect(() => {
		const mountHistoryAnchor = mountHistoryAnchorRef.current;
		if (
			!input.statusReady ||
			mountReconcileStartedIdentityRef.current === feedIdentity ||
			mountHistoryAnchor?.feedIdentity !== feedIdentity ||
			!mountHistoryAnchor.signalId
		) {
			return;
		}

		mountReconcileStartedIdentityRef.current = feedIdentity;
		// This speculative read runs in parallel with the live handshake for a fast
		// cached first paint. Core's hello ack always triggers a second, trailing
		// read after the subscription is accepted, which closes the read/live gap.
		reconcileConversation().catch(() => undefined);
	}, [feedIdentity, input.statusReady, reconcileConversation]);

	useEffect(() => {
		if (
			!input.statusReady ||
			input.history.isPending ||
			!input.history.isSuccess ||
			!skippedReadyReconcilePendingRef.current ||
			readySocketAttemptKeyRef.current === null ||
			readySocketAttemptKeyRef.current !== currentSocketAttemptKeyRef.current
		) {
			return;
		}

		skippedReadyReconcilePendingRef.current = false;
		reconcileConversation({ afterActiveFlight: true }).catch(() => undefined);
	}, [
		input.history.isPending,
		input.history.isSuccess,
		input.statusReady,
		reconcileConversation,
	]);

	useEffect(() => {
		if (!input.participationEnabled) {
			currentSocketAttemptKeyRef.current = null;
			readySocketAttemptKeyRef.current = null;
			clearReconnectTimer(reconnectTimerRef);
			clearReconnectTimer(degradeTimerRef);
			setLiveState("connected");
			setLiveErrorMessage(null);
			return () => {
				clearReconnectTimer(reconnectTimerRef);
				clearReconnectTimer(degradeTimerRef);
			};
		}

		// Once canonical membership confirms participation, connect immediately:
		// the WS chain (proxy hop + gateway auth + DO upgrade) costs hundreds of
		// ms. Early live frames merge into the timeline by signal id, so a later
		// history seed still dedupes cleanly.
		const reconnectAttempt = reconnectKey;
		reconnectKeyRef.current = reconnectAttempt;
		const socketAttemptKey = `${input.spaceId}::${input.openMeldProfileId}::${String(reconnectAttempt)}`;
		currentSocketAttemptKeyRef.current = socketAttemptKey;
		let isDisposed = false;
		let hasAcceptedLiveSession = false;
		let clearKeepaliveTimer: () => void = () => undefined;
		const stopKeepalive = () => {
			clearKeepaliveTimer();
			clearKeepaliveTimer = () => undefined;
		};
		const markSocketClosed = () => {
			if (readySocketAttemptKeyRef.current === socketAttemptKey) {
				readySocketAttemptKeyRef.current = null;
			}
		};

		// Surface "degraded" only if the stream stays down past the grace window.
		// The timer lives at hook scope (not this attempt's closure) so it spans
		// reconnect attempts and is cleared by markConnected / lifecycle resets.
		const armDegradeTimer = () => {
			if (degradeTimerRef.current || liveStateRef.current === "degraded") {
				return;
			}
			degradeTimerRef.current = setTimeout(() => {
				degradeTimerRef.current = null;
				setLiveState("degraded");
				setLiveErrorMessage(LIVE_RECONNECT_STATUS);
			}, LIVE_DEGRADE_GRACE_MS);
		};
		const scheduleReconnect = () => {
			if (isDisposed || reconnectKeyRef.current !== reconnectAttempt) {
				return;
			}
			if (reconnectTimerRef.current) {
				return;
			}

			armDegradeTimer();

			const delayMs = resolveLiveReconnectDelayMs(
				reconnectAttemptCountRef.current
			);
			reconnectAttemptCountRef.current += 1;
			reconnectTimerRef.current = setTimeout(() => {
				reconnectTimerRef.current = null;
				if (isDisposed || reconnectKeyRef.current !== reconnectAttempt) {
					return;
				}
				advanceReconnectKey();
			}, delayMs);
		};
		const markConnected = () => {
			clearReconnectTimer(degradeTimerRef);
			reconnectAttemptCountRef.current = 0;
			setLiveState("connected");
			setLiveErrorMessage(null);
		};

		setLiveState("connecting");
		setLiveErrorMessage(null);

		const socket = new WebSocket(
			createSpaceLiveStreamUrl({
				origin: window.location.origin,
				spaceId: input.spaceId,
				profileId: input.openMeldProfileId,
			})
		);

		const onOpen = () => {
			if (isDisposed) {
				return;
			}

			// Raw WebSocket open proves only the browser-to-Web-proxy transport.
			// Core has not necessarily accepted the Space subscription yet, so
			// product-level connectivity waits for system.hello.ack.
			lastInboundFrameTsRef.current = Date.now();

			// Keep the (proxy-held) live-stream chain warm so a quiet Space's idle
			// socket is never evicted; the Space DO auto-answers this PING. On the
			// same cadence, run the pong-watchdog: if a PING has gone out but no
			// inbound frame has arrived within WATCHDOG_DEADLINE_MS, the socket is
			// half-open — tear it down and let the existing reconnect path rebuild.
			clearKeepaliveTimer = startSpaceLiveKeepaliveTimer({
				onStalled: () => {
					socket.close();
					scheduleReconnect();
				},
				readLastInboundFrameTs: () => lastInboundFrameTsRef.current,
				socket,
			});
		};

		const handleLiveSessionControlMessage = (
			message: SpaceLiveMessage
		): boolean => {
			if (message.kind === "ignored") {
				return true;
			}
			if (message.kind === "agent_stream") {
				handleAgentStreamFrame(message.frame);
				return true;
			}
			if (message.kind !== "ready") {
				return false;
			}
			if (hasAcceptedLiveSession) {
				return true;
			}

			hasAcceptedLiveSession = true;
			// A message cursor cannot recover reactions changed on older messages.
			// Refresh mounted reaction snapshots only after reconnect, not every initial read.
			if (reconnectKey > 0) {
				queryClient
					.invalidateQueries({ queryKey: messageReactionsKey(input.spaceId) })
					.catch(() => undefined);
			}
			queryClient
				.invalidateQueries({
					predicate: (query) =>
						(query.queryKey[0] === "space-message-pins" ||
							query.queryKey[0] === "space-file-pins") &&
						query.queryKey[1] === input.spaceId,
				})
				.catch((error) =>
					console.warn("Failed to refresh Space pins after reconnect.", error)
				);
			readySocketAttemptKeyRef.current = socketAttemptKey;
			markConnected();
			if (historyReadyRef.current) {
				skippedReadyReconcilePendingRef.current = false;
				reconcileConversation({ afterActiveFlight: true }).catch(
					() => undefined
				);
				return true;
			}
			skippedReadyReconcilePendingRef.current = true;
			return true;
		};

		const onMessage = (event: MessageEvent) => {
			if (isDisposed || typeof event.data !== "string") {
				return;
			}

			// Any well-formed inbound frame proves the chain is still delivering,
			// so refresh the watchdog before any semantic routing.
			lastInboundFrameTsRef.current = Date.now();

			// Transport keepalive PONG gets an explicit path: it is pure liveness
			// evidence, not a business signal. Refresh the watchdog (done above)
			// and return before parseSpaceLiveMessage so the PONG sentinel never
			// reaches the signal parser or the timeline.
			if (event.data === SPACE_STREAM_KEEPALIVE_PONG) {
				return;
			}

			const message = parseSpaceLiveMessage(event.data);
			if (handleLiveSessionControlMessage(message)) {
				return;
			}
			if (
				handleNonTimelineLiveMessage({
					liveInvalidationVersionByTypeRef,
					membersRefetch: input.membersRefetch,
					membersRefetchTimerRef,
					message,
					openMeldProfileId: input.openMeldProfileId,
					readinessScope: {
						organizationId: readinessOrganizationId,
						storageScope: readinessStorageScope,
					},
					queryClient,
					setLiveErrorMessage,
					setLiveState,
					spaceId: input.spaceId,
					statusRefetch: input.statusRefetch,
					statusRefetchTimerRef,
					wakeProgressRefreshScopeRef,
				})
			) {
				return;
			}
			if (message.kind !== "signal") {
				return;
			}
			handleLiveSignalMessage({
				openMeldProfileId: input.openMeldProfileId,
				membersRefetch: input.membersRefetch,
				membersRefetchTimerRef,
				message,
				observedWakeFinalOutcomeSignalIdsRef,
				onThreadSignalRef,
				onWakeFinalOutcomeFactsRefreshRef,
				pendingWakeFinalOutcomeRefreshRef,
				persistedTimelineEnvelopesRef,
				queryClient,
				setTimelineEnvelopes,
				spaceId: input.spaceId,
				statusRefetch: input.statusRefetch,
				statusRefetchTimerRef,
				timelineEnvelopesRef,
				wakeFinalOutcomeRefreshTimerRef,
			});
		};

		const onClose = (event: CloseEvent) => {
			markSocketClosed();
			stopKeepalive();
			if (isDisposed) {
				return;
			}

			if (event.code === 1008) {
				input.statusRefetch().catch((error) => {
					console.error(
						"Failed to refresh Space access after session closure",
						error
					);
				});
			}
			scheduleReconnect();
		};

		const onError = () => {
			markSocketClosed();
			stopKeepalive();
			if (isDisposed) {
				return;
			}

			scheduleReconnect();
		};

		socket.addEventListener("open", onOpen);
		socket.addEventListener("message", onMessage);
		socket.addEventListener("close", onClose);
		socket.addEventListener("error", onError);

		return () => {
			isDisposed = true;
			markSocketClosed();
			if (currentSocketAttemptKeyRef.current === socketAttemptKey) {
				currentSocketAttemptKeyRef.current = null;
			}
			stopKeepalive();
			clearReconnectTimer(reconnectTimerRef);
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("message", onMessage);
			socket.removeEventListener("close", onClose);
			socket.removeEventListener("error", onError);
			socket.close();
		};
	}, [
		input.openMeldProfileId,
		input.membersRefetch,
		input.participationEnabled,
		readinessOrganizationId,
		readinessStorageScope,
		input.spaceId,
		input.statusRefetch,
		reconnectKey,
		advanceReconnectKey,
		handleAgentStreamFrame,
		queryClient,
		// Stable across renders (depends only on spaceId/openMeldProfileId, both already
		// here), so this adds no extra reconnect churn — it just satisfies the
		// exhaustive-deps contract for the reconcile call inside onOpen.
		reconcileConversation,
	]);

	return {
		agentStreamProjections,
		liveErrorMessage,
		liveState,
		reconnectNow,
		mergePersistedIncoming: (incoming: readonly SignalEnvelope[]) => {
			recordPersistedTimelineSignals({
				currentRef: persistedTimelineEnvelopesRef,
				incoming,
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.openMeldProfileId,
			});
			return mergeIncomingSignals({
				currentRef: timelineEnvelopesRef,
				incoming,
				setState: setTimelineEnvelopes,
			});
		},
		timelineEnvelopes,
		timelineEnvelopesRef,
	};
}

type SpaceLiveSignalMessage = Extract<SpaceLiveMessage, { kind: "signal" }>;
type SpaceLiveInvalidationMessage = Extract<
	SpaceLiveMessage,
	{ kind: "invalidation" }
>;

function resolveLiveReconnectDelayMs(attemptCount: number): number {
	return (
		LIVE_RECONNECT_DELAYS_MS[
			Math.min(attemptCount, LIVE_RECONNECT_DELAYS_MS.length - 1)
		] ??
		LIVE_RECONNECT_DELAYS_MS.at(-1) ??
		30_000
	);
}

function startSpaceLiveKeepaliveTimer(input: {
	onStalled: () => void;
	readLastInboundFrameTs: () => number | null;
	socket: WebSocket;
}): () => void {
	let hasSentKeepalivePing = false;
	let stopped = false;
	let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
	const stop = () => {
		if (stopped) {
			return;
		}
		stopped = true;
		if (keepaliveTimer !== null) {
			clearInterval(keepaliveTimer);
			keepaliveTimer = null;
		}
	};
	keepaliveTimer = setInterval(() => {
		try {
			input.socket.send(SPACE_STREAM_KEEPALIVE_PING);
			hasSentKeepalivePing = true;
		} catch {
			// Socket already closing; its close handler stops this timer.
		}

		const lastInboundFrameTs = input.readLastInboundFrameTs();
		if (
			hasSentKeepalivePing &&
			lastInboundFrameTs !== null &&
			Date.now() - lastInboundFrameTs > WATCHDOG_DEADLINE_MS
		) {
			stop();
			input.onStalled();
		}
	}, SPACE_STREAM_KEEPALIVE_INTERVAL_MS);
	return stop;
}

function clearReconnectTimer(timerRef: {
	current: ReturnType<typeof setTimeout> | null;
}) {
	if (!timerRef.current) {
		return;
	}

	clearTimeout(timerRef.current);
	timerRef.current = null;
}

type WakeProgressRefreshScope = {
	inFlight: Promise<void> | null;
	pending: boolean;
	scopeKey: string;
};

type WakeProgressRefreshScopeRef = {
	current: WakeProgressRefreshScope | null;
};

type NonTimelineLiveMessageInput = {
	liveInvalidationVersionByTypeRef: { current: Map<string, number> };
	membersRefetch: () => Promise<unknown>;
	membersRefetchTimerRef: { current: ReturnType<typeof setTimeout> | null };
	message: SpaceLiveMessage;
	openMeldProfileId: string;
	readinessScope?: { organizationId: string; storageScope: string };
	queryClient: QueryClient;
	setLiveErrorMessage: (value: string | null) => void;
	setLiveState: (value: SpaceLiveState) => void;
	spaceId: string;
	statusRefetch: () => Promise<unknown>;
	statusRefetchTimerRef: { current: ReturnType<typeof setTimeout> | null };
	wakeProgressRefreshScopeRef: WakeProgressRefreshScopeRef;
};

function handleNonTimelineLiveMessage(
	input: NonTimelineLiveMessageInput
): boolean {
	if (input.message.kind === "server_error") {
		input.setLiveState("degraded");
		input.setLiveErrorMessage(input.message.error.error);
		return true;
	}
	if (input.message.kind === "invalidation") {
		handleLiveInvalidationMessage({ ...input, message: input.message });
		return true;
	}
	return false;
}

function handleLiveInvalidationMessage(
	input: Omit<NonTimelineLiveMessageInput, "message"> & {
		message: SpaceLiveInvalidationMessage;
	}
): void {
	const frame = input.message.frame;
	if (
		!shouldProcessLiveInvalidationFrame({
			frame,
			spaceId: input.spaceId,
			versionsByTypeRef: input.liveInvalidationVersionByTypeRef,
		})
	) {
		return;
	}

	if (frame.type === "space.reactions.changed") {
		for (const signalId of frame.signalIds ?? []) {
			input.queryClient.invalidateQueries({
				queryKey: messageReactionsKey(input.spaceId, signalId),
			});
		}
		return;
	}
	if (frame.type !== "wake.progress.changed") {
		debounceRefetch(input.statusRefetchTimerRef, input.statusRefetch);
	}
	if (frame.type === "space.meta.changed") {
		input.queryClient
			.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] === "spaces" &&
					query.queryKey[1] === input.spaceId &&
					query.queryKey.includes("history-navigation"),
			})
			.catch((error) =>
				console.warn("Failed to refresh history navigation.", error)
			);
		input.queryClient
			.invalidateQueries({ queryKey: ["space-file-pins", input.spaceId] })
			.catch((error) => console.warn("Failed to refresh pinned files.", error));
		input.queryClient
			.invalidateQueries({
				queryKey: ["space-message-pins", input.spaceId],
			})
			.catch((error) =>
				console.warn("Failed to refresh pinned messages.", error)
			);
		invalidateSpaceMetadata(input.queryClient, input.spaceId, frame.reason);
	} else if (frame.type === "space.files.changed") {
		input.queryClient
			.invalidateQueries({ queryKey: ["space-file-pins", input.spaceId] })
			.catch((error) => console.warn("Failed to refresh pinned files.", error));
		invalidateSpaceFiles(input.queryClient, input.spaceId, frame.reason);
	} else if (
		frame.type === "space.members.changed" ||
		frame.type === "agent.readiness.invalidated"
	) {
		debounceRefetch(input.membersRefetchTimerRef, input.membersRefetch);
	}
	if (frame.type === "wake.progress.changed") {
		invalidateWakeProgress(input, frame.reason);
	}
	if (frame.type === "agent.readiness.invalidated") {
		handleAgentReadinessInvalidation(input, frame);
	}
}

function invalidateSpaceMetadata(
	queryClient: QueryClient,
	spaceId: string,
	reason?: string
): void {
	queryClient
		.invalidateQueries({ queryKey: accountSpaceQueryKeys.all })
		.catch((error) => {
			console.warn("[openmeld.web.space.meta_invalidation_refresh_failed]", {
				error: toStructuredApiClientFailure(error).message,
				reason,
				spaceId,
			});
		});
}

function invalidateSpaceFiles(
	queryClient: QueryClient,
	spaceId: string,
	reason?: string
): void {
	queryClient
		.invalidateQueries({ queryKey: spaceFileQueryKeys.space(spaceId) })
		.catch((error) => {
			console.warn("[openmeld.web.space.files_invalidation_refresh_failed]", {
				error: toStructuredApiClientFailure(error).message,
				reason,
				spaceId,
			});
		});
}

function invalidateWakeProgress(
	input: Pick<
		NonTimelineLiveMessageInput,
		| "openMeldProfileId"
		| "queryClient"
		| "spaceId"
		| "wakeProgressRefreshScopeRef"
	>,
	reason?: string
): void {
	const scopeKey = `${input.spaceId}::${input.openMeldProfileId}`;
	let scope = input.wakeProgressRefreshScopeRef.current;
	if (!scope || scope.scopeKey !== scopeKey) {
		scope = { inFlight: null, pending: false, scopeKey };
		input.wakeProgressRefreshScopeRef.current = scope;
	}
	scope.pending = true;
	if (scope.inFlight) {
		return;
	}

	const activeScope = scope;
	activeScope.inFlight = flushWakeProgressRefreshes({
		...input,
		reason,
		scope: activeScope,
	}).finally(() => {
		if (input.wakeProgressRefreshScopeRef.current !== activeScope) {
			return;
		}
		activeScope.inFlight = null;
		if (activeScope.pending) {
			invalidateWakeProgress(input, reason);
		}
	});
}

async function flushWakeProgressRefreshes(
	input: Pick<
		NonTimelineLiveMessageInput,
		| "openMeldProfileId"
		| "queryClient"
		| "spaceId"
		| "wakeProgressRefreshScopeRef"
	> & {
		reason?: string;
		scope: WakeProgressRefreshScope;
	}
): Promise<void> {
	const queryKey = spaceQueryKeys.activeWakeProgressSummary(
		input.spaceId,
		input.openMeldProfileId
	);
	while (
		input.wakeProgressRefreshScopeRef.current === input.scope &&
		input.scope.pending
	) {
		input.scope.pending = false;
		const wasAlreadyFetching = input.queryClient.isFetching({ queryKey }) > 0;
		try {
			await input.queryClient.invalidateQueries(
				{
					queryKey,
					refetchType: "active",
				},
				{ cancelRefetch: false }
			);
		} catch (error) {
			console.warn(
				"[openmeld.web.space.wake_progress_invalidation_refresh_failed]",
				{
					error: toStructuredApiClientFailure(error).message,
					reason: input.reason,
					spaceId: input.spaceId,
				}
			);
		}
		if (
			wasAlreadyFetching &&
			input.wakeProgressRefreshScopeRef.current === input.scope
		) {
			input.scope.pending = true;
		}
	}
}

function handleAgentReadinessInvalidation(
	input: Pick<NonTimelineLiveMessageInput, "readinessScope">,
	frame: SpaceLiveInvalidationMessage["frame"]
): void {
	if (input.readinessScope) {
		publishAgentReadinessInvalidationFrame(frame, input.readinessScope);
	}
}

function handleLiveSignalMessage(input: {
	openMeldProfileId: string;
	membersRefetch: () => Promise<unknown>;
	membersRefetchTimerRef: { current: ReturnType<typeof setTimeout> | null };
	message: SpaceLiveSignalMessage;
	observedWakeFinalOutcomeSignalIdsRef: { current: Set<string> };
	onThreadSignalRef: {
		current:
			| ((input: {
					placement: SpaceThreadSignalPlacement;
					signal: SignalEnvelope;
					threadContext: SpaceThreadContext;
			  }) => void)
			| undefined;
	};
	onWakeFinalOutcomeFactsRefreshRef: {
		current:
			| ((input: {
					agentProfileIds: readonly string[];
					signalIds: readonly string[];
			  }) => Promise<void> | void)
			| undefined;
	};
	pendingWakeFinalOutcomeRefreshRef: {
		current: WakeFinalOutcomeRefreshBatch;
	};
	persistedTimelineEnvelopesRef: { current: readonly SignalEnvelope[] };
	queryClient: QueryClient;
	setTimelineEnvelopes: (next: readonly SignalEnvelope[]) => void;
	spaceId: string;
	statusRefetch: () => Promise<unknown>;
	statusRefetchTimerRef: { current: ReturnType<typeof setTimeout> | null };
	timelineEnvelopesRef: { current: readonly SignalEnvelope[] };
	wakeFinalOutcomeRefreshTimerRef: {
		current: ReturnType<typeof setTimeout> | null;
	};
}): void {
	if (
		input.message.threadContext &&
		input.message.threadPlacement?.placement === "thread"
	) {
		input.onThreadSignalRef.current?.({
			placement: input.message.threadPlacement,
			signal: input.message.signal,
			threadContext: input.message.threadContext,
		});
		scheduleRefetchesForSignals({
			wakeFinalOutcomeHandledByCallback: Boolean(
				input.onWakeFinalOutcomeFactsRefreshRef.current
			),
			membersRefetch: input.membersRefetch,
			membersRefetchTimerRef: input.membersRefetchTimerRef,
			signals: [input.message.signal],
			statusRefetch: input.statusRefetch,
			statusRefetchTimerRef: input.statusRefetchTimerRef,
		});
		scheduleWakeFinalOutcomeFactsRefresh({
			onRefreshRef: input.onWakeFinalOutcomeFactsRefreshRef,
			observedSignalIdsRef: input.observedWakeFinalOutcomeSignalIdsRef,
			pendingRef: input.pendingWakeFinalOutcomeRefreshRef,
			signals: [input.message.signal],
			spaceId: input.spaceId,
			timerRef: input.wakeFinalOutcomeRefreshTimerRef,
		});
		return;
	}

	const newSignals = listNewSignals({
		current: input.timelineEnvelopesRef.current,
		incoming: [input.message.signal],
	});
	if (shouldRecordLiveSignalAsCatchUpAnchor(input.message)) {
		recordPersistedTimelineSignals({
			currentRef: input.persistedTimelineEnvelopesRef,
			incoming: [input.message.signal],
			queryClient: input.queryClient,
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
		});
	}
	mergeIncomingSignals({
		currentRef: input.timelineEnvelopesRef,
		incoming: [input.message.signal],
		setState: input.setTimelineEnvelopes,
	});
	scheduleRefetchesForSignals({
		wakeFinalOutcomeHandledByCallback: Boolean(
			input.onWakeFinalOutcomeFactsRefreshRef.current
		),
		membersRefetch: input.membersRefetch,
		membersRefetchTimerRef: input.membersRefetchTimerRef,
		signals: newSignals,
		statusRefetch: input.statusRefetch,
		statusRefetchTimerRef: input.statusRefetchTimerRef,
	});
	scheduleWakeFinalOutcomeFactsRefresh({
		onRefreshRef: input.onWakeFinalOutcomeFactsRefreshRef,
		observedSignalIdsRef: input.observedWakeFinalOutcomeSignalIdsRef,
		pendingRef: input.pendingWakeFinalOutcomeRefreshRef,
		signals: newSignals,
		spaceId: input.spaceId,
		timerRef: input.wakeFinalOutcomeRefreshTimerRef,
	});
}

function shouldProcessLiveInvalidationFrame(input: {
	frame: SpaceLiveInvalidationMessage["frame"];
	spaceId: string;
	versionsByTypeRef: { current: Map<string, number> };
}): boolean {
	if (input.frame.spaceId !== input.spaceId) {
		return false;
	}
	const lastVersion =
		input.versionsByTypeRef.current.get(input.frame.type) ?? 0;
	if (input.frame.version <= lastVersion) {
		return false;
	}
	input.versionsByTypeRef.current.set(input.frame.type, input.frame.version);
	return true;
}

function recordPersistedTimelineSignals(input: {
	currentRef: { current: readonly SignalEnvelope[] };
	incoming: readonly SignalEnvelope[];
	queryClient: QueryClient;
	spaceId: string;
	openMeldProfileId: string;
}) {
	if (input.incoming.length === 0) {
		return;
	}

	input.currentRef.current = mergeSpaceTimelineEnvelopes({
		current: input.currentRef.current,
		incoming: input.incoming,
	});
	writeSpaceHistoryEnvelopesToCache({
		envelopes: input.incoming,
		queryClient: input.queryClient,
		spaceId: input.spaceId,
		openMeldProfileId: input.openMeldProfileId,
	});
}

function getLatestSignalEnvelopeId(
	envelopes: readonly SignalEnvelope[]
): string | null {
	return envelopes.at(-1)?.id ?? null;
}

function shouldRecordLiveSignalAsCatchUpAnchor(
	message: SpaceLiveSignalMessage
): boolean {
	if (
		message.threadContext &&
		message.threadPlacement?.placement === "thread"
	) {
		return false;
	}
	if (message.history) {
		return message.history.persisted;
	}

	return isSpaceTimelineCatchUpAnchorSignal(message.signal);
}

function scheduleRefetchesForSignals(input: {
	wakeFinalOutcomeHandledByCallback: boolean;
	signals: readonly SignalEnvelope[];
	statusRefetchTimerRef: { current: ReturnType<typeof setTimeout> | null };
	statusRefetch: () => Promise<unknown>;
	membersRefetchTimerRef: { current: ReturnType<typeof setTimeout> | null };
	membersRefetch: () => Promise<unknown>;
}) {
	let shouldRefetchStatus = false;
	let shouldRefetchMembers = false;

	for (const signal of input.signals) {
		if (signal.type === "presence.join" || signal.type === "presence.quit") {
			shouldRefetchStatus = true;
			shouldRefetchMembers = true;
			continue;
		}
		if (
			input.wakeFinalOutcomeHandledByCallback &&
			resolveWakeFinalOutcomeRefreshTarget(signal)
		) {
			continue;
		}

		if (
			signal.type === "signal.status" ||
			signal.type === "signal.system_notice"
		) {
			shouldRefetchStatus = true;
		}

		if (
			shouldRefetchMembersAfterSignal({
				signal,
			})
		) {
			shouldRefetchMembers = true;
		}
	}

	if (shouldRefetchStatus) {
		debounceRefetch(input.statusRefetchTimerRef, input.statusRefetch);
	}
	if (shouldRefetchMembers) {
		debounceRefetch(input.membersRefetchTimerRef, input.membersRefetch);
	}
}

type WakeFinalOutcomeRefreshBatch = {
	agentProfileIds: Set<string>;
	signalIds: Set<string>;
};

function scheduleWakeFinalOutcomeFactsRefresh(input: {
	signals: readonly SignalEnvelope[];
	spaceId: string;
	timerRef: { current: ReturnType<typeof setTimeout> | null };
	pendingRef: { current: WakeFinalOutcomeRefreshBatch };
	observedSignalIdsRef: { current: Set<string> };
	onRefreshRef: {
		current:
			| ((input: {
					agentProfileIds: readonly string[];
					signalIds: readonly string[];
			  }) => Promise<void> | void)
			| undefined;
	};
}) {
	if (!input.onRefreshRef.current || input.signals.length === 0) {
		return;
	}

	let hasNewFinalOutcome = false;

	for (const signal of input.signals) {
		const targetProfileId = resolveWakeFinalOutcomeRefreshTarget(signal);
		if (!targetProfileId) {
			continue;
		}
		if (input.observedSignalIdsRef.current.has(signal.id)) {
			continue;
		}

		input.observedSignalIdsRef.current.add(signal.id);
		input.pendingRef.current.signalIds.add(signal.id);
		input.pendingRef.current.agentProfileIds.add(targetProfileId);
		hasNewFinalOutcome = true;
	}

	if (!hasNewFinalOutcome) {
		return;
	}

	if (input.timerRef.current) {
		clearTimeout(input.timerRef.current);
	}
	input.timerRef.current = setTimeout(() => {
		input.timerRef.current = null;
		const signalIds = [...input.pendingRef.current.signalIds];
		const agentProfileIds = [...input.pendingRef.current.agentProfileIds];
		input.pendingRef.current.signalIds.clear();
		input.pendingRef.current.agentProfileIds.clear();
		if (signalIds.length === 0 || agentProfileIds.length === 0) {
			return;
		}

		Promise.resolve(
			input.onRefreshRef.current?.({ agentProfileIds, signalIds })
		).catch((error) => {
			console.warn(
				"[openmeld.web.space.wake_final_outcome_refresh_callback_failed]",
				{
					agentProfileIds,
					error: error instanceof Error ? error.message : String(error),
					signalIds,
					spaceId: input.spaceId,
				}
			);
		});
	}, 300);
}

function resolveWakeFinalOutcomeRefreshTarget(
	signal: SignalEnvelope
): string | null {
	const markerTarget = resolveCoreReadinessFactsChangedTarget(signal);
	if (markerTarget) {
		return markerTarget;
	}

	if (isWakeFinalReplySignal(signal)) {
		const meta = readSignalTextMeta(signal);
		return (
			normalizeAgentProfileId(readStringField(meta, "targetProfileId")) ??
			normalizeAgentProfileId(signal.profile.profileId)
		);
	}

	if (isRuntimeCoordinatorFinalFailureSignal(signal)) {
		return normalizeAgentProfileId(
			readStringField(readSignalDataRecord(signal), "actorProfileId")
		);
	}

	return null;
}

function resolveCoreReadinessFactsChangedTarget(
	signal: SignalEnvelope
): string | null {
	const signalData = readSignalDataRecord(signal);
	const marker =
		signal.type === "signal.text"
			? readRecord(readSignalTextMeta(signal)?.coreReadinessFactsChanged)
			: readRecord(signalData?.coreReadinessFactsChanged);
	if (
		readStringField(marker, "kind") !== CORE_READINESS_FACTS_CHANGED_MARKER_KIND
	) {
		return null;
	}

	return normalizeAgentProfileId(readStringField(marker, "agentProfileId"));
}

function isWakeFinalReplySignal(signal: SignalEnvelope): boolean {
	const meta = readSignalTextMeta(signal);
	return (
		signal.type === "signal.text" &&
		signal.profile.kind === "agent" &&
		readStringField(meta, "purpose") === AGENT_REPLY_FINAL_PURPOSE
	);
}

function isRuntimeCoordinatorFinalFailureSignal(
	signal: SignalEnvelope
): boolean {
	const data = readSignalDataRecord(signal);
	const dispatchId = readStringField(data, "dispatchId");
	return (
		signal.type === "signal.system_notice" &&
		readStringField(data, "generatedBy") === "openmeld" &&
		readStringField(data, "noticeType") === "terminal_failure" &&
		dispatchId !== null &&
		dispatchId.trim().length > 0
	);
}

function readSignalTextMeta(
	signal: SignalEnvelope
): Record<string, unknown> | null {
	const data = readSignalDataRecord(signal);
	return readRecord(data?.meta);
}

function readSignalDataRecord(
	signal: SignalEnvelope
): Record<string, unknown> | null {
	return readRecord(signal.data);
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readStringField(
	record: Record<string, unknown> | null,
	key: string
): string | null {
	const value = record?.[key];
	return typeof value === "string" ? value : null;
}

function normalizeAgentProfileId(
	value: string | null | undefined
): string | null {
	const normalized = value?.trim() ?? "";
	return normalized.startsWith("agt_") ? normalized : null;
}

function clearWakeFinalOutcomeRefreshTimer(timerRef: {
	current: ReturnType<typeof setTimeout> | null;
}) {
	if (!timerRef.current) {
		return;
	}

	clearTimeout(timerRef.current);
	timerRef.current = null;
}

function shouldRefetchMembersAfterSignal(input: {
	signal: SignalEnvelope;
}): boolean {
	const { signal } = input;
	if (signal.profile.kind !== "agent") {
		return false;
	}

	return (
		signal.type === "signal.text" ||
		signal.type === "signal.status" ||
		signal.type === "signal.system_notice"
	);
}

const refetchesNeedingFollowup = new WeakSet<object>();

function debounceRefetch(
	timerRef: { current: ReturnType<typeof setTimeout> | null },
	refetch: () => Promise<unknown>
) {
	if (timerRef.current) {
		refetchesNeedingFollowup.add(timerRef);
		return;
	}
	const timer = setTimeout(() => {
		refetchesNeedingFollowup.delete(timerRef);
		refetch()
			.catch(() => undefined)
			.finally(() => {
				if (timerRef.current !== timer) {
					return;
				}
				timerRef.current = null;
				if (refetchesNeedingFollowup.delete(timerRef)) {
					debounceRefetch(timerRef, refetch);
				}
			});
	}, 300);
	timerRef.current = timer;
}

function mergeIncomingSignals(input: {
	currentRef: { current: readonly SignalEnvelope[] };
	incoming: readonly SignalEnvelope[];
	setState: (next: readonly SignalEnvelope[]) => void;
}) {
	const merged = mergeSpaceTimelineEnvelopes({
		current: input.currentRef.current,
		incoming: input.incoming,
	});
	input.currentRef.current = merged;
	input.setState(merged);
	return merged;
}

// The Space DO answers a stale catch-up anchor with `space.updates.anchor_not_found`
// (HTTP 404); the gateway surfaces the DO code on `upstreamCode` while mapping the
// gateway-level `code` to the generic `upstream_error`. Only that explicit DO code
// proves the anchor can no longer be resolved server-side. A plain 404 may be a
// missing Space or an authorization boundary, so it must stay observable instead
// of being hidden behind a recent-window reload.
const SPACE_UPDATES_ANCHOR_NOT_FOUND_CODE = "space.updates.anchor_not_found";

function isAnchorNotFoundFailure(failure: StructuredApiClientFailure): boolean {
	return failure.upstreamCode === SPACE_UPDATES_ANCHOR_NOT_FOUND_CODE;
}

function listNewSignals(input: {
	current: readonly SignalEnvelope[];
	incoming: readonly SignalEnvelope[];
}): readonly SignalEnvelope[] {
	if (input.incoming.length === 0) {
		return [];
	}

	const currentSignalIds = new Set(input.current.map((signal) => signal.id));
	return input.incoming.filter((signal) => !currentSignalIds.has(signal.id));
}
