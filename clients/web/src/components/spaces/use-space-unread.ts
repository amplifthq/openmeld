import type {
	SignalEnvelope,
	SpaceInboxUnreadTarget,
} from "@openmeld/schemas/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveLatestVisibleTs } from "#/lib/spaces/unread";

const READ_THROUGH_DEBOUNCE_MS = 800;

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
	isViewingLatest: boolean;
	onViewedThroughTs?: (throughTs: number) => Promise<void> | void;
	spaceId: string;
	targets: readonly SpaceInboxUnreadTarget[];
}): SpaceUnreadState {
	const [visible, setVisible] = useState(isDocumentVisible);
	const [retryState, setRetryState] = useState(() => ({
		attempt: 0,
		spaceId: input.spaceId,
	}));
	const retryAttempt =
		retryState.spaceId === input.spaceId ? retryState.attempt : 0;
	const latestVisibleTs = useMemo(
		() => resolveLatestVisibleTs(input.envelopes),
		[input.envelopes]
	);
	const mainTargets = useMemo(
		() => input.targets.filter((target) => target.threadRootSignalId === null),
		[input.targets]
	);
	const isViewingNow = input.isViewingLatest && visible;
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const persistedThroughTsRef = useRef(0);
	const identityRef = useRef(input.spaceId);
	const latestVisibleTsRef = useRef(latestVisibleTs);
	const isViewingNowRef = useRef(isViewingNow);
	const onViewedThroughTsRef = useRef(input.onViewedThroughTs);
	const mountedRef = useRef(true);

	useEffect(() => {
		latestVisibleTsRef.current = latestVisibleTs;
		isViewingNowRef.current = isViewingNow;
		onViewedThroughTsRef.current = input.onViewedThroughTs;
	}, [input.onViewedThroughTs, isViewingNow, latestVisibleTs]);

	const cancelPendingRead = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	useEffect(() => {
		if (identityRef.current === input.spaceId) {
			return;
		}
		identityRef.current = input.spaceId;
		persistedThroughTsRef.current = 0;
		cancelPendingRead();
	}, [cancelPendingRead, input.spaceId]);

	useEffect(() => {
		const onVisibilityChange = () => setVisible(isDocumentVisible());
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () =>
			document.removeEventListener("visibilitychange", onVisibilityChange);
	}, []);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		cancelPendingRead();
		if (
			!(isViewingNow && input.onViewedThroughTs && latestVisibleTs > 0) ||
			latestVisibleTs <= persistedThroughTsRef.current
		) {
			return;
		}
		const identity = input.spaceId;
		const throughTs = latestVisibleTs;
		const debounceMs =
			READ_THROUGH_DEBOUNCE_MS + Math.min(retryAttempt, 4) * 200;
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			if (
				identityRef.current !== identity ||
				!isViewingNowRef.current ||
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
					if (identityRef.current === identity) {
						persistedThroughTsRef.current = Math.max(
							persistedThroughTsRef.current,
							throughTs
						);
						setRetryState((current) =>
							current.spaceId === identity && current.attempt > 0
								? { attempt: 0, spaceId: identity }
								: current
						);
					}
				})
				.catch((error: unknown) => {
					console.warn(
						"Failed to persist the Space Inbox read position.",
						error
					);
					if (
						mountedRef.current &&
						identityRef.current === identity &&
						isViewingNowRef.current
					) {
						setRetryState((current) => ({
							attempt: current.spaceId === identity ? current.attempt + 1 : 1,
							spaceId: identity,
						}));
					}
				});
		}, debounceMs);
		return cancelPendingRead;
	}, [
		cancelPendingRead,
		input.onViewedThroughTs,
		input.spaceId,
		isViewingNow,
		latestVisibleTs,
		retryAttempt,
	]);

	useEffect(() => cancelPendingRead, [cancelPendingRead]);

	return {
		count: mainTargets.length,
		firstSignalId: mainTargets[0]?.signalId ?? null,
		isReady: input.isReady,
		mainTargets,
	};
}
