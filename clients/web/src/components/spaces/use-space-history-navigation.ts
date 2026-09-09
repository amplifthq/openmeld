import type { SignalEnvelope } from "@openmeld/schemas/types";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { mergeSpaceTimelineEnvelopes } from "#/lib/spaces/timeline";
import { SPACE_HISTORY_SIGNAL_KINDS } from "#/query/spaces/history";

export function useSpaceHistoryNavigation(input: {
	spaceId: string;
	profileId: string;
	enabled: boolean;
	accessRejected: boolean;
	liveEnvelopes: readonly SignalEnvelope[];
}) {
	const identity = `${input.spaceId}:${input.profileId}`;
	const [window, setWindow] = useState<HistoryWindow | null>(null);
	const [liveBoundary, setLiveBoundary] = useState<{
		identity: string;
		signalId: string;
	} | null>(null);
	const liveStartIndex =
		liveBoundary?.identity === identity
			? Math.max(
					0,
					input.liveEnvelopes.findIndex(
						(item) => item.id === liveBoundary.signalId
					)
				)
			: 0;
	const visibleLiveEnvelopes = useMemo(
		() => input.liveEnvelopes.slice(liveStartIndex),
		[input.liveEnvelopes, liveStartIndex]
	);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const flight = useRef<AbortController | null>(null);
	const currentIdentity = useRef(identity);
	currentIdentity.current = identity;
	useEffect(() => {
		currentIdentity.current = identity;
		setWindow(null);
		setPending(false);
		setError(null);
		return () => flight.current?.abort();
	}, [identity]);
	const api = useCallback(
		() => createUnscopedWebSpaceApi({ openMeldProfileId: input.profileId }),
		[input.profileId]
	);
	const directory = useQuery({
		queryKey: ["spaces", input.spaceId, input.profileId, "history-navigation"],
		queryFn: ({ signal }) =>
			api().getHistoryNavigation({ spaceId: input.spaceId, signal }),
		enabled: input.enabled && !input.accessRejected,
		staleTime: 30_000,
		gcTime: 60_000,
	});
	// Live edits and recalls also replace messages in an already-open old window.
	// Keep its boundaries: a new live message must not pull the reader to latest.
	const activeWindow = useMemo(() => {
		if (window?.identity !== identity) {
			return null;
		}
		const ids = new Set(window.envelopes.map((item) => item.id));
		return {
			...window,
			envelopes: mergeSpaceTimelineEnvelopes({
				current: window.envelopes,
				incoming: input.liveEnvelopes.filter((item) => ids.has(item.id)),
			}),
		};
	}, [identity, window, input.liveEnvelopes]);
	const readWindow = async (
		signalId: string,
		direction?: "before" | "after"
	) => {
		if (direction && flight.current) {
			return false;
		}
		flight.current?.abort();
		const controller = new AbortController();
		flight.current = controller;
		const isCurrentRequest = () =>
			!controller.signal.aborted && currentIdentity.current === identity;
		setPending(true);
		setError(null);
		try {
			const result = await api().listSignalEnvelopes({
				spaceId: input.spaceId,
				signal: controller.signal,
				query: {
					aroundSignalId: signalId,
					beforeCount: direction === "after" ? 0 : 30,
					afterCount: direction === "before" ? 0 : 30,
					kinds: SPACE_HISTORY_SIGNAL_KINDS,
				},
			});
			if (!isCurrentRequest()) {
				return false;
			}
			if (!result.envelopes.some((item) => item.id === signalId)) {
				throw new Error("This message is no longer available.");
			}
			// The around SQL applies signal-kind and main-timeline filters before
			// LIMIT. A full side may have more; a short side is an actual boundary.
			const anchorIndex = result.envelopes.findIndex(
				(item) => item.id === signalId
			);
			setWindow((current) =>
				mergeHistoryWindow(
					current,
					identity,
					result.envelopes,
					anchorIndex,
					direction
				)
			);
			return true;
		} catch (failure) {
			if (isCurrentRequest()) {
				setError(navigationErrorMessage(failure));
			}
			return false;
		} finally {
			if (flight.current === controller) {
				flight.current = null;
				setPending(false);
			}
		}
	};
	const latest = () => {
		const first = input.liveEnvelopes.at(-60);
		setLiveBoundary(first ? { identity, signalId: first.id } : null);
		flight.current?.abort();
		flight.current = null;
		setWindow(null);
		setPending(false);
		setError(null);
	};
	return {
		visibleLiveEnvelopes,
		hasHiddenLiveHistory: liveStartIndex > 0,
		revealCachedBefore: () => {
			const first = input.liveEnvelopes[Math.max(0, liveStartIndex - 60)];
			setLiveBoundary(first ? { identity, signalId: first.id } : null);
		},
		directory: directory.data,
		directoryPending: directory.isPending,
		directoryError: directory.isError,
		retryDirectory: () => directory.refetch(),
		activeWindow,
		pending,
		error,
		open: (signalId: string) => readWindow(signalId),
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
	hasBefore: boolean;
	hasAfter: boolean;
};

function navigationErrorMessage(failure: unknown) {
	return failure instanceof Error
		? failure.message
		: "Couldn’t load this part of the conversation. Try again.";
}
