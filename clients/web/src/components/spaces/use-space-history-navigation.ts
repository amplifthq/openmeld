import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { readSpaceConversationPosition } from "#/lib/space-conversation-position";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import {
	listVisibleTimelineEnvelopes,
	mergeSpaceTimelineEnvelopes,
} from "#/lib/spaces/timeline";
import { PERSISTED_DISPLAY_QUERY_GC_TIME_MS } from "#/query/query-config";
import {
	SPACE_HISTORY_SIGNAL_KINDS,
	writeSpaceHistoryEnvelopesToCache,
} from "#/query/spaces/history";
import {
	MissingHistoryAnchorError,
	shouldRetrySpaceHistoryQuery,
} from "#/query/spaces/retry";
import { spaceQueryKeys } from "#/query/spaces/status";
import { buildSpaceConversationScrollRestorationId } from "./space-conversation-scroll-restoration";

export function useSpaceHistoryNavigation(input: {
	spaceId: string;
	profileId: string;
	anonymous?: boolean;
	hrefForSignalId?: (signalId: string) => string;
	initialWindowAnchorSignalId?: string;
	latestHref?: string;
	enabled: boolean;
	accessRejected: boolean;
	liveEnvelopes: readonly SignalEnvelope[];
}) {
	const queryClient = useQueryClient();
	const identity = `${input.spaceId}:${input.profileId}`;
	const visibleSignals = useMemo(
		() => listVisibleTimelineEnvelopes(input.liveEnvelopes),
		[input.liveEnvelopes]
	);
	const [window, setWindow] = useState<HistoryWindow | null>(null);
	const [liveBoundary, setLiveBoundary] = useState<{
		identity: string;
		signalId: string;
	} | null>(null);
	// Keep a stable entry boundary as live messages arrive. An empty bootstrap
	// must not pin the boundary before the persisted history has been restored.
	if (liveBoundary?.identity !== identity && visibleSignals.length > 0) {
		const first = visibleSignals[Math.max(0, visibleSignals.length - 60)];
		if (first) {
			setLiveBoundary({ identity, signalId: first.id });
			const saved = readSpaceConversationPosition(
				`${input.profileId}:${buildSpaceConversationScrollRestorationId(input.spaceId)}`
			);
			const anchor = visibleSignals.findIndex(
				(item) => item.id === saved?.anchorSignalId
			);
			if (
				window?.identity !== identity &&
				!saved?.atBottom &&
				anchor >= 0 &&
				anchor < visibleSignals.length - 60
			) {
				setWindow({
					identity,
					confirmedAtLiveTail: false,
					envelopes: visibleSignals.slice(
						Math.max(0, anchor - 30),
						anchor + 31
					),
					// A cached window does not prove the server's history boundaries.
					hasBefore: true,
					hasAfter: true,
				});
			} else if (window?.identity !== identity) {
				setWindow(null);
			}
		}
	}
	const liveStartIndex =
		liveBoundary?.identity === identity
			? Math.max(
					0,
					visibleSignals.findIndex((item) => item.id === liveBoundary.signalId)
				)
			: Math.max(0, visibleSignals.length - 60);
	const visibleLiveEnvelopes = useMemo(
		() => visibleSignals.slice(liveStartIndex),
		[visibleSignals, liveStartIndex]
	);
	const [request, setRequest] = useState<HistoryRequest | null>(null);
	const [missingMessageIdentity, setMissingMessageIdentity] = useState<
		string | null
	>(null);
	const requestSequence = useRef(0);
	const flight = useRef<AbortController | null>(null);
	useEffect(() => {
		setMissingMessageIdentity(null);
		setRequest((current) =>
			current?.identity === identity && !input.accessRejected ? current : null
		);
		return () => flight.current?.abort();
	}, [identity, input.accessRejected]);
	const api = useCallback(
		() =>
			createUnscopedWebSpaceApi(
				input.anonymous ? {} : { openMeldProfileId: input.profileId }
			),
		[input.profileId, input.anonymous]
	);
	const directory = useQuery({
		queryKey: spaceQueryKeys.historyNavigation(input.spaceId, input.profileId),
		queryFn: ({ signal }) =>
			api().getHistoryNavigation({ spaceId: input.spaceId, signal }),
		enabled: input.enabled && !input.accessRejected,
		staleTime: 30_000,
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
	});
	// Live edits and recalls also replace messages in an already-open old window.
	// Keep its boundaries: a new live message must not pull the reader to latest.
	const activeWindow = useMemo(() => {
		const selectedWindow =
			window?.identity === identity
				? window
				: initialHistoryWindow({
						anchorSignalId: input.initialWindowAnchorSignalId,
						envelopes: visibleSignals,
						identity,
					});
		if (!selectedWindow) {
			return null;
		}
		const ids = new Set(selectedWindow.envelopes.map((item) => item.id));
		const liveTailOverlapIndex = selectedWindow.confirmedAtLiveTail
			? visibleLiveEnvelopes.findLastIndex((item) => ids.has(item.id))
			: -1;
		const newestWindowSignal = selectedWindow.envelopes.at(-1);
		const newestLiveSignal = visibleLiveEnvelopes.at(-1);
		const liveTailIsAhead =
			newestWindowSignal &&
			newestLiveSignal &&
			(newestLiveSignal.ts > newestWindowSignal.ts ||
				(newestLiveSignal.ts === newestWindowSignal.ts &&
					newestLiveSignal.id > newestWindowSignal.id));
		return {
			...selectedWindow,
			hasAfter:
				selectedWindow.hasAfter ||
				(selectedWindow.confirmedAtLiveTail &&
					liveTailOverlapIndex < 0 &&
					Boolean(liveTailIsAhead)),
			envelopes: mergeSpaceTimelineEnvelopes({
				current: selectedWindow.envelopes,
				incoming: [
					...input.liveEnvelopes.filter((item) => ids.has(item.id)),
					...(liveTailOverlapIndex >= 0
						? visibleLiveEnvelopes.slice(liveTailOverlapIndex + 1)
						: []),
				],
			}),
		};
	}, [
		identity,
		window,
		input.initialWindowAnchorSignalId,
		input.liveEnvelopes,
		visibleSignals,
		visibleLiveEnvelopes,
	]);
	const { selectedRequest, historyWindow, pending, error, notice, retry } =
		useHistoryWindowQuery({
			missingMessageIdentity,
			request,
			identity,
			accessRejected: input.accessRejected,
			spaceId: input.spaceId,
			profileId: input.profileId,
			api,
		});
	const appliedResult = useRef<unknown>(null);
	useEffect(() => {
		if (!selectedRequest || selectedRequest.controller.signal.aborted) {
			return;
		}
		if (historyWindow.isError && !historyWindow.isFetching) {
			selectedRequest.resolve(false);
			return;
		}
		const result = historyWindow.data;
		if (!result || result === appliedResult.current) {
			return;
		}
		appliedResult.current = result;
		setMissingMessageIdentity(result.latest ? identity : null);
		writeSpaceHistoryEnvelopesToCache({
			envelopes: result.envelopes,
			queryClient,
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
		});
		setWindow((current) =>
			result.latest
				? {
						identity,
						envelopes: result.envelopes,
						confirmedAtLiveTail: true,
						hasBefore: result.envelopes.length >= 60,
						hasAfter: false,
					}
				: mergeHistoryWindow(
						current?.identity === identity
							? current
							: selectedRequest.baseWindow,
						identity,
						result.envelopes,
						result.anchorIndex,
						selectedRequest.direction
					)
		);
		selectedRequest.resolve(result.latest ? "latest" : true);
		selectedRequest.onLoaded?.(result.latest ? "latest" : true);
	}, [
		selectedRequest,
		historyWindow.data,
		historyWindow.isError,
		historyWindow.isFetching,
		queryClient,
		input.spaceId,
		input.profileId,
		identity,
	]);
	const readWindow = (
		signalId: string,
		direction?: "before" | "after",
		signal?: AbortSignal,
		onLoaded?: HistoryRequest["onLoaded"]
	): Promise<boolean | "latest"> => {
		if (input.accessRejected || signal?.aborted || (direction && pending)) {
			return Promise.resolve(false);
		}
		flight.current?.abort();
		setMissingMessageIdentity(null);
		const controller = new AbortController();
		flight.current = controller;
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		return new Promise((resolve) => {
			controller.signal.addEventListener(
				"abort",
				() => {
					signal?.removeEventListener("abort", abort);
					setRequest((current) =>
						current?.controller === controller ? null : current
					);
					resolve(false);
				},
				{ once: true }
			);
			setRequest({
				identity,
				sequence: ++requestSequence.current,
				signalId,
				direction,
				controller,
				resolve,
				baseWindow: activeWindow,
				onLoaded,
			});
		});
	};
	const latest = () => {
		const first = visibleSignals.at(-60);
		setLiveBoundary(first ? { identity, signalId: first.id } : null);
		flight.current?.abort();
		flight.current = null;
		setRequest(null);
		setWindow(null);
	};
	const { earlierSignal, newerSignal } = continuationSignals({
		activeWindow,
		directoryTotal: directory.data?.total ?? 0,
		fetchedCount: visibleSignals.length,
		liveStartIndex,
		visibleLiveEnvelopes,
	});
	return {
		hrefForSignalId: input.hrefForSignalId,
		earlierHref:
			input.hrefForSignalId && earlierSignal
				? input.hrefForSignalId(earlierSignal.id)
				: undefined,
		latestHref: input.latestHref,
		newerHref:
			input.hrefForSignalId && newerSignal
				? input.hrefForSignalId(newerSignal.id)
				: undefined,
		visibleLiveEnvelopes,
		hasHiddenLiveHistory: liveStartIndex > 0,
		revealCachedBefore: (envelopes = input.liveEnvelopes) => {
			const signals = listVisibleTimelineEnvelopes(envelopes);
			const first = signals[Math.max(0, liveStartIndex - 60)];
			setLiveBoundary(first ? { identity, signalId: first.id } : null);
		},
		directory: directory.data,
		directoryPending: directory.isPending,
		directoryError: directory.isError,
		retryDirectory: () => directory.refetch(),
		activeWindow,
		pending,
		pendingDirection: pending ? selectedRequest?.direction : undefined,
		error,
		notice,
		errorDirection: error ? selectedRequest?.direction : undefined,
		retry,
		open: (
			signalId: string,
			signal?: AbortSignal,
			onLoaded?: HistoryRequest["onLoaded"]
		) => readWindow(signalId, undefined, signal, onLoaded),
		latest,
		loadBefore: () =>
			activeWindow?.hasBefore && activeWindow.envelopes[0]
				? readWindow(activeWindow.envelopes[0].id, "before")
				: Promise.resolve(false),
		loadAfter: () => {
			const last = activeWindow?.envelopes.at(-1);
			return activeWindow?.hasAfter && last
				? readWindow(last.id, "after")
				: Promise.resolve(false);
		},
	};
}

export type SpaceHistoryNavigationController = ReturnType<
	typeof useSpaceHistoryNavigation
>;

function useHistoryWindowQuery(input: {
	missingMessageIdentity: string | null;
	request: HistoryRequest | null;
	identity: string;
	accessRejected: boolean;
	spaceId: string;
	profileId: string;
	api: () => ReturnType<typeof createUnscopedWebSpaceApi>;
}) {
	const requestOwner = useId();
	const selectedRequest =
		input.request?.identity === input.identity && !input.accessRejected
			? input.request
			: null;
	const historyWindow = useQuery<Awaited<ReturnType<typeof readHistoryWindow>>>(
		{
			queryKey: [
				...spaceQueryKeys.historyWindow(input.spaceId, input.profileId),
				requestOwner,
				selectedRequest?.sequence ?? null,
			],
			enabled: selectedRequest !== null,
			gcTime: 0,
			staleTime: Number.POSITIVE_INFINITY,
			retry: shouldRetrySpaceHistoryQuery,
			refetchOnWindowFocus: (query) =>
				shouldRetrySpaceHistoryQuery(0, query.state.error),
			refetchOnReconnect: (query) =>
				shouldRetrySpaceHistoryQuery(0, query.state.error),
			queryFn: ({ signal }) =>
				readHistoryWindow(input.api(), input.spaceId, selectedRequest, signal),
		}
	);
	return {
		selectedRequest,
		retry: shouldRetrySpaceHistoryQuery(0, historyWindow.error)
			? () => historyWindow.refetch()
			: undefined,
		notice:
			input.missingMessageIdentity === input.identity && !input.accessRejected
				? "This message is no longer available in this conversation. Showing the latest messages."
				: null,
		historyWindow,
		pending: selectedRequest !== null && historyWindow.fetchStatus !== "idle",
		error:
			selectedRequest && historyWindow.isError
				? navigationErrorMessage(historyWindow.error)
				: null,
	};
}

async function readHistoryWindow(
	api: ReturnType<typeof createUnscopedWebSpaceApi>,
	spaceId: string,
	request: HistoryRequest | null,
	signal: AbortSignal
) {
	if (!request) {
		throw new Error("No history position selected.");
	}
	const { signalId, direction } = request;
	const result = await api
		.listSignalEnvelopes({
			spaceId,
			signal,
			query: {
				aroundSignalId: signalId,
				beforeCount: direction === "after" ? 0 : 30,
				afterCount: direction === "before" ? 0 : 30,
				kinds: SPACE_HISTORY_SIGNAL_KINDS,
			},
		})
		.catch((failure: unknown) => {
			if (
				toStructuredApiClientFailure(failure).upstreamCode !==
				"space.signals.anchor_not_found"
			) {
				throw failure;
			}
			return { envelopes: [] };
		});
	const anchorIndex = result.envelopes.findIndex(
		(item) => item.id === signalId
	);
	if (anchorIndex >= 0) {
		return { envelopes: result.envelopes, anchorIndex, latest: false };
	}
	if (direction) {
		throw new MissingHistoryAnchorError();
	}
	// Reauthorize in the same Space; a missing anchor never permits a cross-Space search.
	const latest = await api.listSignalEnvelopes({
		spaceId,
		signal,
		query: { recent: true, limit: 60, kinds: SPACE_HISTORY_SIGNAL_KINDS },
	});
	return { envelopes: latest.envelopes, anchorIndex: -1, latest: true };
}

function mergeHistoryWindow(
	current: HistoryWindow | null,
	identity: string,
	envelopes: readonly SignalEnvelope[],
	anchorIndex: number,
	direction?: "before" | "after"
): HistoryWindow {
	const merged =
		direction && current?.identity === identity
			? mergeSpaceTimelineEnvelopes({
					current: current.envelopes,
					incoming: envelopes,
				})
			: envelopes;
	return {
		identity,
		envelopes: merged,
		confirmedAtLiveTail:
			direction === "before" && current?.identity === identity
				? current.confirmedAtLiveTail
				: envelopes.length - anchorIndex - 1 < 30,
		hasBefore:
			direction === "after" && current?.identity === identity
				? current.hasBefore
				: anchorIndex >= 30,
		hasAfter:
			direction === "before" && current?.identity === identity
				? current.hasAfter
				: envelopes.length - anchorIndex - 1 >= 30,
	};
}

type HistoryRequest = {
	identity: string;
	sequence: number;
	signalId: string;
	direction?: "before" | "after";
	controller: AbortController;
	resolve: (result: boolean | "latest") => void;
	baseWindow: HistoryWindow | null;
	// Navigation completion also applies when the first attempt failed and Query later recovered.
	onLoaded?: (result: true | "latest") => void;
};

type HistoryWindow = {
	identity: string;
	envelopes: readonly SignalEnvelope[];
	confirmedAtLiveTail: boolean;
	hasBefore: boolean;
	hasAfter: boolean;
};

function continuationSignals(input: {
	activeWindow: HistoryWindow | null;
	directoryTotal: number;
	fetchedCount: number;
	liveStartIndex: number;
	visibleLiveEnvelopes: readonly SignalEnvelope[];
}) {
	if (input.activeWindow) {
		return {
			earlierSignal: input.activeWindow.hasBefore
				? input.activeWindow.envelopes[0]
				: undefined,
			newerSignal: input.activeWindow.hasAfter
				? input.activeWindow.envelopes.at(-1)
				: undefined,
		};
	}
	return {
		earlierSignal:
			input.liveStartIndex > 0 || input.directoryTotal > input.fetchedCount
				? input.visibleLiveEnvelopes[0]
				: undefined,
		newerSignal: undefined,
	};
}

function initialHistoryWindow(input: {
	anchorSignalId?: string;
	envelopes: readonly SignalEnvelope[];
	identity: string;
}): HistoryWindow | null {
	if (!input.anchorSignalId) {
		return null;
	}
	const anchorIndex = input.envelopes.findIndex(
		(item) => item.id === input.anchorSignalId
	);
	if (anchorIndex < 0) {
		return null;
	}
	return {
		identity: input.identity,
		envelopes: input.envelopes,
		confirmedAtLiveTail: false,
		hasBefore: anchorIndex >= 30,
		hasAfter: input.envelopes.length - anchorIndex - 1 >= 30,
	};
}

function navigationErrorMessage(failure: unknown) {
	if (failure instanceof MissingHistoryAnchorError) {
		return "This message is no longer available. Open the latest messages to continue.";
	}
	const { status } = toStructuredApiClientFailure(failure);
	if (status === 401 || status === 403) {
		return "You don’t have access to this conversation. Return to Inbox to view your other updates.";
	}
	return "Couldn’t load this part of the conversation.";
}
