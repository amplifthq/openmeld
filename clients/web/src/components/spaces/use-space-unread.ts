import type {
	SignalEnvelope,
	SpaceInboxUnreadTarget,
} from "@openmeld/schemas/types";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { resolveLatestVisibleTs } from "#/lib/spaces/unread";

// Keep a brief dwell to ignore fly-by navigation, then use the Inbox owner's
// optimistic update rather than making readers wait for a network round trip.
const READ_THROUGH_DEBOUNCE_MS = 150;

function isDocumentVisible(): boolean {
	return (
		typeof document === "undefined" || document.visibilityState === "visible"
	);
}

export type SpaceUnreadState = {
	count: number;
	firstSignalId: string | null;
	isReady: boolean;
	mainTargets: readonly SpaceInboxUnreadTarget[];
};

export function useSpaceUnread(input: {
	envelopes: readonly SignalEnvelope[];
	isReady: boolean;
	profileId: string;
	onViewedThroughTs?: (throughTs: number) => Promise<void> | void;
	spaceId: string;
	targets: readonly SpaceInboxUnreadTarget[];
}): SpaceUnreadState & { onViewingLatestChange: (viewing: boolean) => void } {
	const latestVisibleTs = useMemo(() => {
		const loadedIds = new Set(input.envelopes.map((signal) => signal.id));
		return input.targets.reduce(
			(latest, target) =>
				target.threadRootSignalId === null && loadedIds.has(target.signalId)
					? Math.max(latest, target.occurredAtMs)
					: latest,
			resolveLatestVisibleTs(input.envelopes)
		);
	}, [input.envelopes, input.targets]);
	const mainTargets = useMemo(
		() => input.targets.filter((target) => target.threadRootSignalId === null),
		[input.targets]
	);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const persistedThroughTsRef = useRef(0);
	const identity = `${input.spaceId}::${input.profileId}`;
	const identityRef = useRef(identity);
	const latestVisibleTsRef = useRef(latestVisibleTs);
	const isViewingNowRef = useRef(false);
	const onViewedThroughTsRef = useRef(input.onViewedThroughTs);
	const mountedRef = useRef(true);
	const retryAttemptRef = useRef(0);

	const cancelPendingRead = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const scheduleRead = useCallback(
		function schedule() {
			cancelPendingRead();
			const throughTs = latestVisibleTsRef.current;
			if (
				!(
					mountedRef.current &&
					isViewingNowRef.current &&
					isDocumentVisible() &&
					onViewedThroughTsRef.current &&
					throughTs > 0
				) ||
				throughTs <= persistedThroughTsRef.current
			) {
				return;
			}
			const scheduledIdentity = identityRef.current;
			const debounceMs =
				READ_THROUGH_DEBOUNCE_MS + Math.min(retryAttemptRef.current, 4) * 200;
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				if (
					identityRef.current !== scheduledIdentity ||
					!isViewingNowRef.current ||
					!isDocumentVisible() ||
					latestVisibleTsRef.current < throughTs
				) {
					return;
				}
				const persist = onViewedThroughTsRef.current;
				if (!persist) {
					return;
				}
				Promise.resolve(persist(throughTs))
					.then(() => {
						if (
							mountedRef.current &&
							identityRef.current === scheduledIdentity
						) {
							persistedThroughTsRef.current = Math.max(
								persistedThroughTsRef.current,
								throughTs
							);
							retryAttemptRef.current = 0;
						}
					})
					.catch((error: unknown) => {
						console.warn(
							"Failed to persist the Space Inbox read position.",
							error
						);
						if (
							mountedRef.current &&
							identityRef.current === scheduledIdentity &&
							isViewingNowRef.current
						) {
							retryAttemptRef.current += 1;
							schedule();
						}
					});
			}, debounceMs);
		},
		[cancelPendingRead]
	);

	// Scroll observations are imperative: changing this fact must cancel reads
	// immediately without synchronously rendering the entire Space transcript.
	const onViewingLatestChange = useCallback(
		(viewing: boolean) => {
			if (identityRef.current !== identity) {
				identityRef.current = identity;
				persistedThroughTsRef.current = 0;
				retryAttemptRef.current = 0;
				isViewingNowRef.current = false;
			}
			if (isViewingNowRef.current === viewing) {
				return;
			}
			isViewingNowRef.current = viewing;
			scheduleRead();
		},
		[identity, scheduleRead]
	);

	useLayoutEffect(() => {
		const changed =
			identityRef.current !== identity ||
			latestVisibleTsRef.current !== latestVisibleTs ||
			Boolean(onViewedThroughTsRef.current) !==
				Boolean(input.onViewedThroughTs);
		if (identityRef.current !== identity) {
			identityRef.current = identity;
			persistedThroughTsRef.current = 0;
			retryAttemptRef.current = 0;
			isViewingNowRef.current = false;
		}
		latestVisibleTsRef.current = latestVisibleTs;
		onViewedThroughTsRef.current = input.onViewedThroughTs;
		if (changed) {
			scheduleRead();
		}
	}, [identity, input.onViewedThroughTs, latestVisibleTs, scheduleRead]);
	useLayoutEffect(() => {
		mountedRef.current = true;
		scheduleRead();
		document.addEventListener("visibilitychange", scheduleRead);
		return () => {
			mountedRef.current = false;
			cancelPendingRead();
			document.removeEventListener("visibilitychange", scheduleRead);
		};
	}, [cancelPendingRead, scheduleRead]);

	return {
		count: mainTargets.length,
		firstSignalId: mainTargets[0]?.signalId ?? null,
		isReady: input.isReady,
		mainTargets,
		onViewingLatestChange,
	};
}
