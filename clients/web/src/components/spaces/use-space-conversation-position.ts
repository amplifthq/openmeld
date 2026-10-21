import {
	type RefObject,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { recordReactUpdate } from "#/lib/observability/react-update-trace";
import {
	readSpaceConversationPosition,
	type SpaceConversationPosition,
	writeSpaceConversationPosition,
} from "#/lib/space-conversation-position";

const TOP_OVERLAY_HEIGHT_PROPERTY = "--space-conversation-top-overlay-height";
const BOTTOM_THRESHOLD_PX = 12;

export type SpaceConversationRestorationStatus = "restoring" | "ready";

export function getSpaceConversationVisibleTop(
	viewport: HTMLDivElement
): number {
	const height = Number.parseFloat(
		window
			.getComputedStyle(viewport)
			.getPropertyValue(TOP_OVERLAY_HEIGHT_PROPERTY)
	);
	return (
		viewport.getBoundingClientRect().top +
		(Number.isFinite(height) ? height : 0)
	);
}

export function resolveSpaceConversationPosition(
	viewport: HTMLDivElement
): SpaceConversationPosition | null {
	const top = getSpaceConversationVisibleTop(viewport);
	// DOM order stays chronological after prepends. Only measure the binary
	// search path, rather than forcing geometry reads for every old message.
	const elements = viewport.querySelectorAll<HTMLElement>(
		"[data-history-signal-id]"
	);
	let low = 0;
	let high = elements.length;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (elements.item(mid).getBoundingClientRect().bottom <= top) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	// A long transient reply can fill the viewport. Keep a nearby recorded
	// message as the reference, even when that message is just outside it.
	const element = elements[Math.min(low, elements.length - 1)];
	if (!element?.dataset.historySignalId) {
		return null;
	}
	const bounds = element.getBoundingClientRect();
	if (bounds.bottom <= bounds.top) {
		return null;
	}
	return {
		anchorSignalId: element.dataset.historySignalId,
		offsetFromVisibleTop: bounds.top - top,
	};
}

type ConversationPositionSession = {
	ready: boolean;
	protectedAnchor: boolean;
	restore: () => void;
	syncObservedElements: () => void;
};

export function useSpaceConversationPosition(input: {
	historyIsPending: boolean;
	isLiveHistory: boolean;
	historyVersion: unknown;
	hasExplicitFocus: boolean;
	messageElementsRef: RefObject<Map<string, HTMLElement>>;
	restorationId: string;
	selfProfileId: string;
	viewport: HTMLDivElement | null;
}) {
	const positionKey = `${input.selfProfileId}:${input.restorationId}`;
	// biome-ignore lint/correctness/useExhaustiveDependencies: A remounted viewport must read the position saved by its previous instance.
	const rememberedPosition = useMemo(
		() => readSpaceConversationPosition(positionKey),
		[positionKey, input.viewport]
	);
	const shouldRestore =
		!input.hasExplicitFocus &&
		Boolean(rememberedPosition && !rememberedPosition.atBottom);
	const [restoration, setRestoration] = useState<{
		key: string;
		status: SpaceConversationRestorationStatus;
	}>({
		key: positionKey,
		status: shouldRestore ? "restoring" : "ready",
	});
	const restorationStatus =
		restoration.key === positionKey
			? restoration.status
			: initialRestorationStatus(shouldRestore);
	// The last requested restoration state. Layout effects compare against it so
	// they only schedule a render when the visible status actually changes.
	const requestedRestorationRef = useRef(restoration);
	const saveRef = useRef<() => void>(() => undefined);
	const releaseRef = useRef<() => void>(() => undefined);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const releasedKeyRef = useRef<string | null>(null);
	const restorationReadyKeyRef = useRef<string | null>(
		restorationStatus === "ready" ? positionKey : null
	);
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const sessionRef = useRef<ConversationPositionSession | null>(null);
	const latestRef = useRef({
		historyIsPending: input.historyIsPending,
		isLiveHistory: input.isLiveHistory,
		rememberedPosition,
		shouldRestore,
	});
	const [followingViewport, setFollowingViewport] =
		useState<HTMLDivElement | null>(null);

	// Runs before the effects below in every commit, so long-lived listeners and
	// observer callbacks always read the current inputs without re-subscribing.
	useLayoutEffect(() => {
		latestRef.current = {
			historyIsPending: input.historyIsPending,
			isLiveHistory: input.isLiveHistory,
			rememberedPosition,
			shouldRestore,
		};
	});

	// One positioning session per viewport and conversation. History updates do
	// not tear it down: re-subscribing would force a layout read (the cleanup
	// save) right after every DOM mutation, and status writes here would cascade
	// into extra renders inside the same frame.
	useLayoutEffect(() => {
		const viewport = input.viewport;
		if (!viewport) {
			return;
		}
		const isNewViewport = viewportRef.current !== viewport;
		if (isNewViewport) {
			viewportRef.current = viewport;
			releasedKeyRef.current = null;
		}
		let disposed = false;
		const session: ConversationPositionSession = {
			ready: false,
			protectedAnchor:
				latestRef.current.shouldRestore &&
				releasedKeyRef.current !== positionKey,
			restore: () => undefined,
			syncObservedElements: () => undefined,
		};
		const requestRestoration = (status: SpaceConversationRestorationStatus) => {
			const requested = requestedRestorationRef.current;
			if (requested.key === positionKey && requested.status === status) {
				return;
			}
			const next = { key: positionKey, status };
			requestedRestorationRef.current = next;
			setRestoration(next);
		};
		if (isNewViewport || requestedRestorationRef.current.key !== positionKey) {
			const status = session.protectedAnchor ? "restoring" : "ready";
			restorationReadyKeyRef.current = status === "ready" ? positionKey : null;
			if (
				requestedRestorationRef.current.key !== positionKey ||
				requestedRestorationRef.current.status !== status
			) {
				recordReactUpdate("conversation_position_restore");
				requestRestoration(status);
			}
		}
		const markReady = () => {
			if (restorationReadyKeyRef.current === positionKey) {
				return;
			}
			restorationReadyKeyRef.current = positionKey;
			recordReactUpdate("conversation_position_ready");
			requestRestoration("ready");
		};
		const save = () => {
			const latest = latestRef.current;
			if (
				!session.ready ||
				latest.historyIsPending ||
				session.protectedAnchor
			) {
				return;
			}
			const position = resolveSpaceConversationPosition(viewport);
			if (position) {
				writeSpaceConversationPosition(positionKey, {
					...position,
					...(latest.isLiveHistory &&
					viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <=
						BOTTOM_THRESHOLD_PX
						? { atBottom: true as const }
						: {}),
				});
			}
		};
		saveRef.current = save;
		const release = () => {
			session.protectedAnchor = false;
			releasedKeyRef.current = positionKey;
			session.ready = !latestRef.current.historyIsPending;
			markReady();
		};
		releaseRef.current = release;
		const restore = () => {
			const { historyIsPending, rememberedPosition: remembered } =
				latestRef.current;
			if (disposed || historyIsPending) {
				return;
			}
			if (!session.protectedAnchor) {
				session.ready = true;
				return;
			}
			const anchor = remembered
				? input.messageElementsRef.current.get(remembered.anchorSignalId)
				: undefined;
			if (remembered && !anchor) {
				// A saved coordinate without its cached message is not useful enough to
				// block or later move the reader. The bounded Space history cache owns
				// instant restoration; an evicted anchor falls back to the live view.
				release();
				return;
			}
			alignReadingPosition(viewport, anchor, remembered);
			session.ready = true;
			markReady();
		};
		session.restore = restore;
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				[
					"ArrowUp",
					"ArrowDown",
					"PageUp",
					"PageDown",
					"Home",
					"End",
					" ",
				].includes(event.key)
			) {
				release();
			}
		};
		// ResizeObserver already batches layout changes before paint. Deferring
		// restoration to rAF would paint one frame at the wrong position when
		// content-visibility reveals a row's actual height. Only adjust scrolling;
		// do not resize the observed elements inside this callback.
		const observer = new ResizeObserver(restore);
		observer.observe(viewport);
		const observedElements = new Set<HTMLElement>();
		session.syncObservedElements = () => {
			const current = new Set(input.messageElementsRef.current.values());
			for (const element of observedElements) {
				if (!current.has(element)) {
					observer.unobserve(element);
					observedElements.delete(element);
				}
			}
			for (const element of current) {
				if (!observedElements.has(element)) {
					observer.observe(element);
					observedElements.add(element);
				}
			}
		};
		viewport.addEventListener("wheel", release, { passive: true });
		viewport.addEventListener("touchstart", release, { passive: true });
		const controls = viewport.parentElement ?? viewport;
		controls.addEventListener("pointerdown", release);
		viewport.addEventListener("keydown", onKeyDown);
		window.addEventListener("pagehide", save);
		sessionRef.current = session;
		return () => {
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
			save();
			disposed = true;
			observer.disconnect();
			viewport.removeEventListener("wheel", release);
			viewport.removeEventListener("touchstart", release);
			controls.removeEventListener("pointerdown", release);
			viewport.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("pagehide", save);
			if (sessionRef.current === session) {
				sessionRef.current = null;
			}
			saveRef.current = () => undefined;
			releaseRef.current = () => undefined;
		};
	}, [input.viewport, input.messageElementsRef, positionKey]);

	// New history mounts new message elements, which must be observed and kept
	// aligned with a protected reading anchor. Align mounted history in this
	// layout effect, before it can paint at the default start position.
	// biome-ignore lint/correctness/useExhaustiveDependencies: History identity is the signal that message elements changed.
	useLayoutEffect(() => {
		const session = sessionRef.current;
		if (!session) {
			return;
		}
		session.protectedAnchor =
			shouldRestore && releasedKeyRef.current !== positionKey;
		session.ready = false;
		session.syncObservedElements();
		session.restore();
	}, [
		input.viewport,
		input.historyIsPending,
		input.isLiveHistory,
		input.historyVersion,
		positionKey,
		rememberedPosition,
		shouldRestore,
	]);

	const save = useCallback(
		(viewport: HTMLDivElement) => {
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
			saveTimerRef.current = null;
			saveRef.current();
			if (
				releasedKeyRef.current === positionKey &&
				viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <=
					BOTTOM_THRESHOLD_PX
			) {
				recordReactUpdate("conversation_position_follow");
				setFollowingViewport(viewport);
			}
		},
		[positionKey]
	);
	const scheduleSave = useCallback(
		(viewport: HTMLDivElement) => {
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
			saveTimerRef.current = setTimeout(() => save(viewport), 120);
		},
		[save]
	);
	const followLatest = useCallback(() => {
		releaseRef.current();
		recordReactUpdate("conversation_position_follow");
		setFollowingViewport(input.viewport);
	}, [input.viewport]);
	const releaseReadingPosition = useCallback(() => releaseRef.current(), []);
	return {
		releaseReadingPosition,
		/** The saved reading anchor this conversation will restore, if any. */
		restorationAnchorSignalId: shouldRestore
			? (rememberedPosition?.anchorSignalId ?? null)
			: null,
		restorationStatus,
		followLatest,
		autoScroll:
			!shouldRestore ||
			(input.viewport !== null && followingViewport === input.viewport),
		defaultScrollPosition: shouldRestore
			? ("start" as const)
			: ("end" as const),
		onScroll: scheduleSave,
		onScrollEnd: save,
	};
}

function initialRestorationStatus(
	shouldRestore: boolean
): SpaceConversationRestorationStatus {
	return shouldRestore ? "restoring" : "ready";
}

function alignReadingPosition(
	viewport: HTMLDivElement,
	anchor: HTMLElement | undefined,
	position: SpaceConversationPosition | null
) {
	if (anchor && position) {
		viewport.scrollTop +=
			anchor.getBoundingClientRect().top -
			getSpaceConversationVisibleTop(viewport) -
			position.offsetFromVisibleTop;
	}
}
