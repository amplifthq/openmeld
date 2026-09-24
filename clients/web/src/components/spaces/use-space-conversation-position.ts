import { useElementScrollRestoration } from "@tanstack/react-router";
import {
	type RefObject,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getAppScrollRestorationKey } from "#/lib/app-scroll-restoration";
import {
	readSpaceConversationPosition,
	type SpaceConversationPosition,
	writeSpaceConversationPosition,
} from "#/lib/space-conversation-position";

const TOP_OVERLAY_HEIGHT_PROPERTY = "--space-conversation-top-overlay-height";

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

export function useSpaceConversationPosition(input: {
	historyIsPending: boolean;
	historyVersion: unknown;
	hasExplicitFocus: boolean;
	messageElementsRef: RefObject<Map<string, HTMLElement>>;
	restorationId: string;
	selfProfileId: string;
	viewport: HTMLDivElement | null;
}) {
	const routerEntry = useElementScrollRestoration({
		getKey: getAppScrollRestorationKey,
		id: input.restorationId,
	});
	const positionKey = `${input.selfProfileId}:${input.restorationId}`;
	// Restoration reads the entry at mount, not the cache updated by scrolling.
	// biome-ignore lint/correctness/useExhaustiveDependencies: A new viewport starts a new restoration session.
	const initialRouterEntry = useMemo(
		() => (routerEntry ? { scrollY: routerEntry.scrollY } : undefined),
		[positionKey, input.viewport]
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: A remounted viewport must read the position saved by its previous instance.
	const rememberedPosition = useMemo(
		() => readSpaceConversationPosition(positionKey),
		[positionKey, input.viewport]
	);
	const shouldRestore =
		!input.hasExplicitFocus &&
		Boolean(rememberedPosition || initialRouterEntry);
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
	const saveRef = useRef<() => void>(() => undefined);
	const releaseRef = useRef<() => void>(() => undefined);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const releasedKeyRef = useRef<string | null>(null);
	const restorationReadyKeyRef = useRef<string | null>(
		restorationStatus === "ready" ? positionKey : null
	);
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const [followingViewport, setFollowingViewport] =
		useState<HTMLDivElement | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: New history mounts new message elements which must be measured and observed.
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
		let ready = false;
		let protectedAnchor =
			shouldRestore && releasedKeyRef.current !== positionKey;
		if (isNewViewport || restoration.key !== positionKey) {
			const status = protectedAnchor ? "restoring" : "ready";
			restorationReadyKeyRef.current = status === "ready" ? positionKey : null;
			setRestoration({ key: positionKey, status });
		}
		const markReady = () => {
			if (restorationReadyKeyRef.current === positionKey) {
				return;
			}
			restorationReadyKeyRef.current = positionKey;
			setRestoration({ key: positionKey, status: "ready" });
		};
		const save = () => {
			if (!ready || input.historyIsPending || protectedAnchor) {
				return;
			}
			const position = resolveSpaceConversationPosition(viewport);
			if (position) {
				writeSpaceConversationPosition(positionKey, position);
			}
		};
		saveRef.current = save;
		const restore = () => {
			if (disposed || input.historyIsPending) {
				return;
			}
			if (!protectedAnchor) {
				ready = true;
				return;
			}
			const anchor = rememberedPosition
				? input.messageElementsRef.current.get(
						rememberedPosition.anchorSignalId
					)
				: undefined;
			if (rememberedPosition && !anchor) {
				// A saved coordinate without its cached message is not useful enough to
				// block or later move the reader. The bounded Space history cache owns
				// instant restoration; an evicted anchor falls back to the live view.
				release();
				return;
			}
			alignReadingPosition(
				viewport,
				anchor,
				rememberedPosition,
				ready ? undefined : initialRouterEntry?.scrollY
			);
			ready = true;
			markReady();
		};
		const release = () => {
			protectedAnchor = false;
			releasedKeyRef.current = positionKey;
			ready = !input.historyIsPending;
			markReady();
		};
		releaseRef.current = release;
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
		for (const element of input.messageElementsRef.current.values()) {
			observer.observe(element);
		}
		viewport.addEventListener("wheel", release, { passive: true });
		viewport.addEventListener("touchstart", release, { passive: true });
		const controls = viewport.parentElement ?? viewport;
		controls.addEventListener("pointerdown", release);
		viewport.addEventListener("keydown", onKeyDown);
		window.addEventListener("pagehide", save);
		// Align mounted history in this layout effect, before it can paint at the
		// default start position. Resize corrections also run before paint.
		restore();
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
			saveRef.current = () => undefined;
			releaseRef.current = () => undefined;
		};
	}, [
		input.viewport,
		input.historyIsPending,
		input.historyVersion,
		input.messageElementsRef,
		positionKey,
		restoration.key,
		restoration.status,
		rememberedPosition,
		initialRouterEntry,
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
				viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 12
			) {
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
		setFollowingViewport(input.viewport);
	}, [input.viewport]);
	const releaseReadingPosition = useCallback(() => releaseRef.current(), []);
	return {
		releaseReadingPosition,
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
	position: SpaceConversationPosition | null,
	scrollY: number | undefined
) {
	if (anchor && position) {
		viewport.scrollTop +=
			anchor.getBoundingClientRect().top -
			getSpaceConversationVisibleTop(viewport) -
			position.offsetFromVisibleTop;
		return;
	}
	if (scrollY !== undefined) {
		viewport.scrollTop = Math.min(
			scrollY,
			Math.max(0, viewport.scrollHeight - viewport.clientHeight)
		);
	}
}
