import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
	const [pending, setPending] = useState(false);
	const [pendingDirection, setPendingDirection] = useState<
		"before" | "after" | undefined
	>();
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [errorDirection, setErrorDirection] = useState<
		"before" | "after" | undefined
	>();
	const flight = useRef<AbortController | null>(null);
	const currentIdentity = useRef(identity);
	currentIdentity.current = identity;
	useEffect(() => {
		currentIdentity.current = identity;
		setPending(false);
		setPendingDirection(undefined);
		setError(null);
		setNotice(null);
		setErrorDirection(undefined);
		return () => flight.current?.abort();
	}, [identity]);
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
	const showLatestForMissingAnchor = async (
		signal: AbortSignal,
		isCurrentRequest: () => boolean,
		direction?: "before" | "after"
	) => {
		if (direction) {
			setError(
				"This message is no longer available. Open the latest messages to continue."
			);
			setErrorDirection(direction);
			return false;
		}
		// Reauthorize the same conversation. Never search other Spaces for
		// a historical notification's misplaced or removed message id.
		const latest = await api().listSignalEnvelopes({
			spaceId: input.spaceId,
			signal,
			query: { recent: true, limit: 60, kinds: SPACE_HISTORY_SIGNAL_KINDS },
		});
		if (!isCurrentRequest()) {
			return false;
		}
		writeSpaceHistoryEnvelopesToCache({
			envelopes: latest.envelopes,
			queryClient,
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
		});
		setWindow({
			identity,
			envelopes: latest.envelopes,
			confirmedAtLiveTail: true,
			hasBefore: latest.envelopes.length >= 60,
			hasAfter: false,
		});
		setNotice(
			"This message is no longer available in this conversation. Showing the latest messages."
		);
		return "latest" as const;
	};
	const readWindow = async (
		signalId: string,
		direction?: "before" | "after",
		signal?: AbortSignal
	) => {
		if (
			input.accessRejected ||
			signal?.aborted ||
			(direction && flight.current)
		) {
			return false;
		}
		flight.current?.abort();
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		flight.current = controller;
		const isCurrentRequest = () =>
			!controller.signal.aborted && currentIdentity.current === identity;
		setPending(true);
		setPendingDirection(direction);
		setError(null);
		setNotice(null);
		setErrorDirection(undefined);
		try {
			const result = await api()
				.listSignalEnvelopes({
					spaceId: input.spaceId,
					signal: controller.signal,
					query: {
						aroundSignalId: signalId,
						beforeCount: direction === "after" ? 0 : 30,
						afterCount: direction === "before" ? 0 : 30,
						kinds: SPACE_HISTORY_SIGNAL_KINDS,
					},
				})
				.catch((failure: unknown) => {
					const structured = toStructuredApiClientFailure(failure);
					if (structured.upstreamCode !== "space.signals.anchor_not_found") {
						throw failure;
					}
					return { envelopes: [] };
				});
			if (!isCurrentRequest()) {
				return false;
			}
			if (!result.envelopes.some((item) => item.id === signalId)) {
				return await showLatestForMissingAnchor(
					controller.signal,
					isCurrentRequest,
					direction
				);
			}
			writeSpaceHistoryEnvelopesToCache({
				envelopes: result.envelopes,
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
			});
			// The around SQL applies signal-kind and main-timeline filters before
			// LIMIT. A full side may have more; a short side is an actual boundary.
			const anchorIndex = result.envelopes.findIndex(
				(item) => item.id === signalId
			);
			setWindow((current) => {
				const currentWindow =
					current?.identity === identity ? current : activeWindow;
				return mergeHistoryWindow(
					currentWindow,
					identity,
					result.envelopes,
					anchorIndex,
					direction
				);
			});
			return true;
		} catch (failure) {
			if (isCurrentRequest()) {
				setError(navigationErrorMessage(failure));
				setErrorDirection(direction);
			}
			return false;
		} finally {
			signal?.removeEventListener("abort", abort);
			if (flight.current === controller) {
				flight.current = null;
				setPending(false);
				setPendingDirection(undefined);
			}
		}
	};
	const latest = () => {
		const first = visibleSignals.at(-60);
		setLiveBoundary(first ? { identity, signalId: first.id } : null);
		flight.current?.abort();
		flight.current = null;
		setWindow(null);
		setPending(false);
		setPendingDirection(undefined);
		setError(null);
		setErrorDirection(undefined);
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
		pendingDirection,
		error,
		notice,
		errorDirection,
		open: (signalId: string, signal?: AbortSignal) =>
			readWindow(signalId, undefined, signal),
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
	const { status } = toStructuredApiClientFailure(failure);
	if (status === 401 || status === 403) {
		return "You don’t have access to this conversation. Return to Inbox to view your other updates.";
	}
	return "Couldn’t load this part of the conversation. Try again.";
}
