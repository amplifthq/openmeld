import { useReducedMotion } from "framer-motion";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { SpaceConversationDatePill } from "./space-conversation-date-marker";

const DATE_MARKER_SELECTOR = "[data-conversation-date-marker]";
const STICKY_TOP_PROPERTY = "--space-conversation-sticky-top";
const TOP_OVERLAY_HEIGHT_PROPERTY = "--space-conversation-top-overlay-height";
const DATE_PILL_HEIGHT_PX = 32;

type StickyDateState = {
	activeDateMs: number | null;
	pushOffsetPx: number;
};

const EMPTY_STICKY_DATE_STATE: StickyDateState = {
	activeDateMs: null,
	pushOffsetPx: 0,
};

export function SpaceConversationStickyDate(input: {
	loadedSignalCount: number;
	onActiveDateMsChange: (dateMs: number | null) => void;
	onJumpToDate?: (date: Date) => Promise<string | null>;
	scrollElement: HTMLDivElement | null;
	topOverlayElement: HTMLDivElement | null;
}) {
	const shouldReduceMotion = useReducedMotion() === true;
	const stickyDate = useStickyConversationDate(
		input.scrollElement,
		input.topOverlayElement,
		input.onActiveDateMsChange
	);

	if (stickyDate.activeDateMs === null) {
		return null;
	}

	const pushOffsetPx = shouldReduceMotion ? 0 : stickyDate.pushOffsetPx;

	return (
		<div
			className="pointer-events-none sticky top-[calc(var(--space-conversation-sticky-top,0px)+0.5rem)] z-10 -mb-8 flex h-8 w-full justify-center"
			data-slot="conversation-date-pill"
		>
			<div
				className="h-8 w-full overflow-hidden"
				data-slot="conversation-date-pill-viewport"
			>
				<div
					className="flex w-full flex-col items-center"
					data-slot="conversation-date-pill-track"
					style={{
						transform: `translate3d(0, ${String(pushOffsetPx)}px, 0)`,
					}}
				>
					<div className="pointer-events-auto h-8">
						<SpaceConversationDatePill
							date={new Date(stickyDate.activeDateMs)}
							loadedSignalCount={input.loadedSignalCount}
							onJumpToDate={input.onJumpToDate}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

function useStickyConversationDate(
	scrollElement: HTMLDivElement | null,
	topOverlayElement: HTMLDivElement | null,
	onActiveDateMsChange: (dateMs: number | null) => void
) {
	const [stickyDate, setStickyDate] = useState<StickyDateState>(
		EMPTY_STICKY_DATE_STATE
	);
	const publishedActiveDateMsRef = useRef<number | null>(null);
	const syncFrameRef = useRef<number | null>(null);
	const publishActiveDateMs = useCallback(
		(dateMs: number | null) => {
			if (publishedActiveDateMsRef.current === dateMs) {
				return;
			}
			publishedActiveDateMsRef.current = dateMs;
			onActiveDateMsChange(dateMs);
		},
		[onActiveDateMsChange]
	);
	const syncStickyTop = useCallback(() => {
		if (!scrollElement) {
			return;
		}
		if (!topOverlayElement) {
			scrollElement.style.removeProperty(STICKY_TOP_PROPERTY);
			scrollElement.style.removeProperty(TOP_OVERLAY_HEIGHT_PROPERTY);
			return;
		}

		const overlayHeight = Math.max(
			0,
			Math.ceil(topOverlayElement.getBoundingClientRect().height)
		);
		scrollElement.style.setProperty(
			TOP_OVERLAY_HEIGHT_PROPERTY,
			`${String(overlayHeight)}px`
		);
		const scrollPaddingTop = Number.parseFloat(
			getComputedStyle(scrollElement).paddingTop
		);
		const stickyTop = Math.max(
			0,
			overlayHeight - (Number.isFinite(scrollPaddingTop) ? scrollPaddingTop : 0)
		);
		scrollElement.style.setProperty(
			STICKY_TOP_PROPERTY,
			`${String(stickyTop)}px`
		);
	}, [scrollElement, topOverlayElement]);

	const syncStickyDate = useCallback(() => {
		if (!scrollElement) {
			publishActiveDateMs(null);
			setStickyDate(EMPTY_STICKY_DATE_STATE);
			return;
		}

		const markers = Array.from(
			scrollElement.querySelectorAll<HTMLElement>(DATE_MARKER_SELECTOR)
		);
		if (markers.length === 0) {
			publishActiveDateMs(null);
			setStickyDate(EMPTY_STICKY_DATE_STATE);
			return;
		}

		const scrollElementStyle = getComputedStyle(scrollElement);
		const stickyTopValue = Number.parseFloat(
			scrollElementStyle.getPropertyValue(STICKY_TOP_PROPERTY)
		);
		const stickyTop = Number.isFinite(stickyTopValue) ? stickyTopValue : 0;
		const scrollPaddingTopValue = Number.parseFloat(
			scrollElementStyle.paddingTop
		);
		const scrollPaddingTop = Number.isFinite(scrollPaddingTopValue)
			? scrollPaddingTopValue
			: 0;
		const markerActivationTop =
			scrollElement.getBoundingClientRect().top + scrollPaddingTop + stickyTop;
		const activeMarkerIndex = resolveActiveMarkerIndex(
			markers,
			markerActivationTop
		);
		if (activeMarkerIndex < 0) {
			publishActiveDateMs(null);
			setStickyDate(EMPTY_STICKY_DATE_STATE);
			return;
		}

		const activeDateMs = resolveMarkerDateMs(markers[activeMarkerIndex]);
		if (activeDateMs === null) {
			return;
		}
		publishActiveDateMs(activeDateMs);
		const nextMarker = markers[activeMarkerIndex + 1] ?? null;
		const nextMarkerTop = nextMarker?.getBoundingClientRect().top ?? null;
		const pushOffsetPx =
			nextMarkerTop === null
				? 0
				: Math.min(
						0,
						Math.max(
							-DATE_PILL_HEIGHT_PX,
							nextMarkerTop - markerActivationTop - DATE_PILL_HEIGHT_PX
						)
					);
		const nextState = {
			activeDateMs,
			pushOffsetPx: Math.round(pushOffsetPx * 2) / 2,
		};
		setStickyDate((currentState) =>
			areStickyDateStatesEqual(currentState, nextState)
				? currentState
				: nextState
		);
	}, [publishActiveDateMs, scrollElement]);

	const scheduleStickyDateSync = useCallback(() => {
		if (syncFrameRef.current !== null) {
			return;
		}
		syncFrameRef.current = window.requestAnimationFrame(() => {
			syncFrameRef.current = null;
			syncStickyDate();
		});
	}, [syncStickyDate]);

	useLayoutEffect(() => {
		syncStickyTop();
		syncStickyDate();
		if (!scrollElement) {
			return;
		}

		scrollElement.addEventListener("scroll", scheduleStickyDateSync, {
			passive: true,
		});
		const contentElement = scrollElement.querySelector<HTMLElement>(
			"[data-slot='message-scroller-content']"
		);
		const resizeObserver =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver((entries) => {
						if (
							topOverlayElement &&
							entries.some((entry) => entry.target === topOverlayElement)
						) {
							syncStickyTop();
						}
						scheduleStickyDateSync();
					});
		resizeObserver?.observe(scrollElement);
		if (contentElement) {
			resizeObserver?.observe(contentElement);
		}
		if (topOverlayElement) {
			resizeObserver?.observe(topOverlayElement);
		}
		let mutationObserver: MutationObserver | null = null;
		if (contentElement && typeof MutationObserver !== "undefined") {
			mutationObserver = new MutationObserver(scheduleStickyDateSync);
			mutationObserver.observe(contentElement, { childList: true });
		}

		return () => {
			scrollElement.removeEventListener("scroll", scheduleStickyDateSync);
			resizeObserver?.disconnect();
			mutationObserver?.disconnect();
			scrollElement.style.removeProperty(STICKY_TOP_PROPERTY);
			scrollElement.style.removeProperty(TOP_OVERLAY_HEIGHT_PROPERTY);
			if (syncFrameRef.current !== null) {
				window.cancelAnimationFrame(syncFrameRef.current);
				syncFrameRef.current = null;
			}
		};
	}, [
		scheduleStickyDateSync,
		scrollElement,
		syncStickyDate,
		syncStickyTop,
		topOverlayElement,
	]);

	return stickyDate;
}

function resolveActiveMarkerIndex(
	markers: HTMLElement[],
	activationTop: number
) {
	let activeMarkerIndex = -1;
	let lowerBound = 0;
	let upperBound = markers.length - 1;
	while (lowerBound <= upperBound) {
		const middleIndex = Math.floor((lowerBound + upperBound) / 2);
		const middleMarker = markers[middleIndex];
		if (!middleMarker) {
			break;
		}
		if (middleMarker.getBoundingClientRect().top <= activationTop) {
			activeMarkerIndex = middleIndex;
			lowerBound = middleIndex + 1;
		} else {
			upperBound = middleIndex - 1;
		}
	}
	return activeMarkerIndex;
}

function resolveMarkerDateMs(marker: HTMLElement | null | undefined) {
	if (!marker) {
		return null;
	}
	const dateMs = Number(marker.dataset.conversationDateMs);
	return Number.isFinite(dateMs) ? dateMs : null;
}

function areStickyDateStatesEqual(
	left: StickyDateState,
	right: StickyDateState
) {
	return (
		left.activeDateMs === right.activeDateMs &&
		left.pushOffsetPx === right.pushOffsetPx
	);
}
