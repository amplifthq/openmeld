import type { SignalEnvelope } from "@openmeld/schemas/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	resolveLatestVisibleTs,
	resolveUnreadSignalState,
} from "#/lib/spaces/unread";
import {
	readSpaceCursorLastSeenTs,
	writeSpaceCursorLastSeenTs,
} from "#/query/spaces/cursor";

const CURSOR_WRITE_DEBOUNCE_MS = 800;

type SpaceReadIdentity = {
	spaceId: string;
	openMeldProfileId: string;
};

function isDocumentVisible(): boolean {
	return (
		typeof document === "undefined" || document.visibilityState === "visible"
	);
}

function isSameIdentity(
	left: SpaceReadIdentity,
	right: SpaceReadIdentity
): boolean {
	return (
		left.spaceId === right.spaceId &&
		left.openMeldProfileId === right.openMeldProfileId
	);
}

// Session-scoped unread count seeded from (and written back to) the shared
// server read cursor. A read position is durable only after the Messages view
// remains visible at the latest message for the full debounce. Core Inbox owns
// the sidebar unread projection, so its idempotent write is tracked and retried
// separately from the Space cursor.
export type SpaceUnreadState = {
	count: number;
	firstSignalId: string | null;
	isReady: boolean;
};

export function useSpaceUnread(input: {
	spaceId: string;
	openMeldProfileId: string;
	envelopes: readonly SignalEnvelope[];
	isViewingLatest: boolean;
	onViewedThroughTs?: (throughTs: number) => Promise<void> | void;
}): SpaceUnreadState {
	const [lastSeenTs, setLastSeenTs] = useState(0);
	const [isCursorReady, setIsCursorReady] = useState(false);
	const [firstUnreadSignalId, setFirstUnreadSignalId] = useState<string | null>(
		null
	);
	const [visible, setVisible] = useState(isDocumentVisible);
	const latestVisibleTs = useMemo(
		() => resolveLatestVisibleTs(input.envelopes),
		[input.envelopes]
	);
	const isViewingNow = input.isViewingLatest && visible;

	const identityRef = useRef<SpaceReadIdentity>({
		spaceId: input.spaceId,
		openMeldProfileId: input.openMeldProfileId,
	});
	const latestVisibleTsRef = useRef(latestVisibleTs);
	const isViewingNowRef = useRef(isViewingNow);
	const onViewedThroughTsRef = useRef(input.onViewedThroughTs);
	const cursorPersistedThroughTsRef = useRef(0);
	const inboxPersistedThroughTsRef = useRef(0);
	const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const schedulePersistenceRef = useRef<(throughTs?: number) => void>(
		() => undefined
	);
	const mountedRef = useRef(true);

	useEffect(() => {
		latestVisibleTsRef.current = latestVisibleTs;
		isViewingNowRef.current = isViewingNow;
		onViewedThroughTsRef.current = input.onViewedThroughTs;
	}, [latestVisibleTs, isViewingNow, input.onViewedThroughTs]);

	const cancelPendingPersistence = useCallback(() => {
		if (writeTimerRef.current) {
			clearTimeout(writeTimerRef.current);
			writeTimerRef.current = null;
		}
	}, []);

	const persistCursor = useCallback(
		async (identity: SpaceReadIdentity, throughTs: number) => {
			if (throughTs <= cursorPersistedThroughTsRef.current) {
				return;
			}
			try {
				await writeSpaceCursorLastSeenTs({
					lastSeenTs: throughTs,
					spaceId: identity.spaceId,
					openMeldProfileId: identity.openMeldProfileId,
				});
				if (isSameIdentity(identityRef.current, identity)) {
					cursorPersistedThroughTsRef.current = Math.max(
						cursorPersistedThroughTsRef.current,
						throughTs
					);
				}
			} catch (error) {
				console.warn(
					"Failed to persist the Space message read position.",
					error
				);
			}
		},
		[]
	);

	const persistInbox = useCallback(
		async (identity: SpaceReadIdentity, throughTs: number) => {
			if (throughTs <= inboxPersistedThroughTsRef.current) {
				return;
			}
			const persist = onViewedThroughTsRef.current;
			if (!persist) {
				return;
			}
			try {
				await persist(throughTs);
				if (isSameIdentity(identityRef.current, identity)) {
					inboxPersistedThroughTsRef.current = Math.max(
						inboxPersistedThroughTsRef.current,
						throughTs
					);
				}
			} catch (error) {
				console.warn("Failed to persist the Space Inbox read position.", error);
			}
		},
		[]
	);

	const schedulePersistence = useCallback(
		(requestedThroughTs?: number) => {
			cancelPendingPersistence();
			if (!(isViewingNowRef.current && latestVisibleTsRef.current > 0)) {
				return;
			}
			const identity = { ...identityRef.current };
			const throughTs = requestedThroughTs ?? latestVisibleTsRef.current;
			writeTimerRef.current = setTimeout(() => {
				writeTimerRef.current = null;
				if (
					!(
						mountedRef.current &&
						isViewingNowRef.current &&
						isSameIdentity(identityRef.current, identity)
					) ||
					latestVisibleTsRef.current < throughTs
				) {
					return;
				}

				setLastSeenTs((current) => Math.max(current, throughTs));
				Promise.all([
					persistCursor(identity, throughTs),
					persistInbox(identity, throughTs),
				]).then(() => {
					if (
						mountedRef.current &&
						isViewingNowRef.current &&
						isSameIdentity(identityRef.current, identity) &&
						writeTimerRef.current === null &&
						(cursorPersistedThroughTsRef.current < latestVisibleTsRef.current ||
							(onViewedThroughTsRef.current !== undefined &&
								inboxPersistedThroughTsRef.current <
									latestVisibleTsRef.current))
					) {
						schedulePersistenceRef.current();
					}
				});
			}, CURSOR_WRITE_DEBOUNCE_MS);
		},
		[cancelPendingPersistence, persistCursor, persistInbox]
	);
	useEffect(() => {
		schedulePersistenceRef.current = schedulePersistence;
	}, [schedulePersistence]);

	// Reset on a Space identity change, then seed the in-message cursor. The Core
	// Inbox acknowledgement intentionally starts unknown so the visible latest
	// position is reported even when the older Space cursor is already current.
	useEffect(() => {
		const identity = {
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
		};
		cancelPendingPersistence();
		identityRef.current = identity;
		cursorPersistedThroughTsRef.current = 0;
		inboxPersistedThroughTsRef.current = 0;
		setLastSeenTs(0);
		setIsCursorReady(false);
		setFirstUnreadSignalId(null);
		if (
			identity.spaceId.trim().length === 0 ||
			identity.openMeldProfileId.trim().length === 0
		) {
			return;
		}
		let isDisposed = false;
		readSpaceCursorLastSeenTs(identity)
			.then((seeded) => {
				if (isDisposed) {
					return;
				}
				if (seeded !== null) {
					cursorPersistedThroughTsRef.current = Math.max(
						cursorPersistedThroughTsRef.current,
						seeded
					);
					setLastSeenTs((current) => Math.max(current, seeded));
				}
				setIsCursorReady(true);
			})
			.catch((error: unknown) => {
				if (!isDisposed) {
					console.warn(
						"Failed to read the Space message read position.",
						error
					);
					setIsCursorReady(true);
				}
			});
		return () => {
			isDisposed = true;
			cancelPendingPersistence();
		};
	}, [input.spaceId, input.openMeldProfileId, cancelPendingPersistence]);

	useEffect(() => {
		const onVisibilityChange = () => setVisible(isDocumentVisible());
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () =>
			document.removeEventListener("visibilitychange", onVisibilityChange);
	}, []);

	useEffect(() => {
		if (isViewingNow) {
			schedulePersistence(latestVisibleTs);
			return cancelPendingPersistence;
		}
		cancelPendingPersistence();
	}, [
		isViewingNow,
		latestVisibleTs,
		schedulePersistence,
		cancelPendingPersistence,
	]);

	useEffect(() => {
		if (input.onViewedThroughTs && isViewingNow) {
			schedulePersistence(latestVisibleTs);
			return cancelPendingPersistence;
		}
	}, [
		input.onViewedThroughTs,
		isViewingNow,
		latestVisibleTs,
		schedulePersistence,
		cancelPendingPersistence,
	]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			cancelPendingPersistence();
		};
	}, [cancelPendingPersistence]);

	// While actively viewing, treat the rendered latest message as read without
	// committing it until the continuous-visibility debounce completes.
	const effectiveLastSeenTs = isViewingNow
		? Math.max(lastSeenTs, latestVisibleTs)
		: lastSeenTs;
	const unreadSinceSavedCursor = useMemo(
		() =>
			resolveUnreadSignalState({
				envelopes: input.envelopes,
				selfProfileId: input.openMeldProfileId,
				lastSeenTs,
			}),
		[input.envelopes, input.openMeldProfileId, lastSeenTs]
	);
	// Keep one stable boundary during an unread epoch, then release it after the
	// durable cursor consumes that epoch so the next message can own a new one.
	useEffect(() => {
		if (!isCursorReady) {
			return;
		}
		setFirstUnreadSignalId((current) =>
			unreadSinceSavedCursor.firstSignalId
				? (current ?? unreadSinceSavedCursor.firstSignalId)
				: null
		);
	}, [isCursorReady, unreadSinceSavedCursor.firstSignalId]);

	return useMemo(() => {
		if (!isCursorReady) {
			return { count: 0, firstSignalId: null, isReady: false };
		}
		const currentUnreadState = resolveUnreadSignalState({
			envelopes: input.envelopes,
			selfProfileId: input.openMeldProfileId,
			lastSeenTs: effectiveLastSeenTs,
		});
		return {
			...currentUnreadState,
			firstSignalId:
				firstUnreadSignalId ?? unreadSinceSavedCursor.firstSignalId,
			isReady: true,
		};
	}, [
		input.envelopes,
		input.openMeldProfileId,
		effectiveLastSeenTs,
		firstUnreadSignalId,
		isCursorReady,
		unreadSinceSavedCursor.firstSignalId,
	]);
}
