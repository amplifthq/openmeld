import { useReducedMotion } from "framer-motion";
import {
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { SpaceConversationDatePill } from "./space-conversation-date-marker";

const DATE_MARKER_SELECTOR = "[data-conversation-date-marker]";
const STICKY_TOP_PROPERTY = "--space-conversation-sticky-top";
const TOP_OVERLAY_HEIGHT_PROPERTY = "--space-conversation-top-overlay-height";
const DEFAULT_DATE_PILL_HEIGHT_PX = 32;
// The pill sits just inside the scroller; activation uses the same offset so
// its center meets the in-flow date line without a vertical jump.
const STICKY_DATE_TOP_OFFSET_PX = -10;

type StickyDateState = {
	activeDateMs: number | null;
	pushOffsetPx: number;
};

const EMPTY_STICKY_DATE_STATE: StickyDateState = {
	activeDateMs: null,
	pushOffsetPx: 0,
};

export function SpaceConversationStickyDate(input: {
	afterDate?: ReactNode;
	/**
	 * The date of mounted content above the first date marker, when that
	 * marker belongs to an entry that is loaded but not mounted yet.
	 */
	leadingDateMs?: number | null;
	loadedSignalCount: number;
	onJumpToDate?: (date: Date) => Promise<string | null>;
	scrollElement: HTMLDivElement | null;
	topOverlayElement: HTMLDivElement | null;
}) {
	const shouldReduceMotion = useReducedMotion() === true;
	const [datePillElement, setDatePillElement] = useState<HTMLDivElement | null>(
		null
	);
	const stickyDate = useStickyConversationDate(
		input.scrollElement,
		input.topOverlayElement,
		datePillElement,
		input.leadingDateMs ?? null
	);

	if (stickyDate.activeDateMs === null && !input.afterDate) {
		return null;
	}

	const pushOffsetPx = shouldReduceMotion ? 0 : stickyDate.pushOffsetPx;

	const overlayHost = input.scrollElement?.parentElement;
	if (!overlayHost) {
		return null;
	}
	return createPortal(
		<div
			className="pointer-events-none absolute inset-x-0 z-10 flex h-8 w-full justify-center max-lg:h-11"
			data-slot="conversation-date-pill"
			style={{
				top: `calc(var(${STICKY_TOP_PROPERTY}, 0px) + ${String(STICKY_DATE_TOP_OFFSET_PX)}px)`,
			}}
		>
			{stickyDate.activeDateMs !== null && (
				<div
					className="-mt-0.5 h-[calc(100%+0.25rem)] w-full py-0.5"
					data-slot="conversation-date-pill-viewport"
					data-space-conversation-content-width=""
				>
					<div
						className="flex w-full flex-col items-center"
						data-slot="conversation-date-pill-track"
						style={{
							transform: `translate3d(0, ${String(pushOffsetPx)}px, 0)`,
						}}
					>
						<div
							className="pointer-events-auto h-8 max-lg:h-11"
							data-slot="conversation-date-pill-surface"
							ref={setDatePillElement}
						>
							<SpaceConversationDatePill
								date={new Date(stickyDate.activeDateMs)}
								loadedSignalCount={input.loadedSignalCount}
								onJumpToDate={input.onJumpToDate}
							/>
						</div>
					</div>
				</div>
			)}
			<div
				className="pointer-events-none absolute inset-x-0 top-full mt-2 flex justify-center"
				data-slot="conversation-after-date"
			>
				<div
					className="flex w-full justify-center"
					data-space-conversation-content-width=""
				>
					{input.afterDate}
				</div>
			</div>
		</div>,
		overlayHost
	);
}

function useStickyConversationDate(
	scrollElement: HTMLDivElement | null,
	topOverlayElement: HTMLDivElement | null,
	datePillElement: HTMLDivElement | null,
	leadingDateMs: number | null
) {
	const [stickyDate, setStickyDate] = useState<StickyDateState>(
		EMPTY_STICKY_DATE_STATE
	);
	const leadingDateMsRef = useRef(leadingDateMs);
	const stuckPillRef = useRef<HTMLElement | null>(null);
	const syncFrameRef = useRef<number | null>(null);
	// The floating pill owns its counterpart in the flow. Crossing a date must
	// not publish state to the entire transcript and rerender every message.
	const setStuckMarker = useCallback((marker: HTMLElement | null) => {
		const pill =
			marker?.querySelector<HTMLElement>(
				"[data-conversation-date-marker-pill]"
			) ?? null;
		if (stuckPillRef.current === pill) {
			return;
		}
		if (stuckPillRef.current) {
			stuckPillRef.current.hidden = false;
		}
		stuckPillRef.current = pill;
		if (pill) {
			pill.hidden = true;
		}
	}, []);
	const syncStickyTop = useCallback(() => {
		if (!scrollElement) {
			return;
		}
		if (!topOverlayElement) {
			scrollElement.parentElement?.style.setProperty(
				STICKY_TOP_PROPERTY,
				getComputedStyle(scrollElement).paddingTop
			);
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
		scrollElement.parentElement?.style.setProperty(
			STICKY_TOP_PROPERTY,
			`${String(Math.max(overlayHeight, Number.isFinite(scrollPaddingTop) ? scrollPaddingTop : 0))}px`
		);
		scrollElement.style.setProperty(
			STICKY_TOP_PROPERTY,
			`${String(stickyTop)}px`
		);
	}, [scrollElement, topOverlayElement]);

	const syncStickyDate = useCallback(() => {
		if (!scrollElement) {
			setStuckMarker(null);
			setStickyDate(EMPTY_STICKY_DATE_STATE);
			return;
		}

		const markers = Array.from(
			scrollElement.querySelectorAll<HTMLElement>(DATE_MARKER_SELECTOR)
		);
		const leadingDate = leadingDateMsRef.current;
		if (markers.length === 0 && leadingDate === null) {
			setStuckMarker(null);
			setStickyDate(EMPTY_STICKY_DATE_STATE);
			return;
		}

		const datePillHeightPx = resolveDatePillHeightPx(datePillElement);
		const markerActivationTop = resolveMarkerActivationTop({
			datePillHeightPx,
			markerHeightPx: markers[0]?.getBoundingClientRect().height ?? 48,
			scrollElement,
		});
		const activeMarkerIndex = resolveActiveMarkerIndex(
			markers,
			markerActivationTop
		);
		if (activeMarkerIndex < 0 && leadingDate === null) {
			setStuckMarker(null);
			setStickyDate(EMPTY_STICKY_DATE_STATE);
			return;
		}

		const activeDateMs =
			activeMarkerIndex < 0
				? leadingDate
				: resolveMarkerDateMs(markers[activeMarkerIndex]);
		if (activeDateMs === null) {
			return;
		}
		setStuckMarker(markers[activeMarkerIndex] ?? null);
		const nextMarker = markers[activeMarkerIndex + 1] ?? null;
		const nextMarkerTop = nextMarker?.getBoundingClientRect().top ?? null;
		const pushOffsetPx =
			nextMarkerTop === null
				? 0
				: Math.min(
						0,
						Math.max(
							-datePillHeightPx,
							nextMarkerTop - markerActivationTop - datePillHeightPx
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
	}, [datePillElement, setStuckMarker, scrollElement]);

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
		if (leadingDateMsRef.current === leadingDateMs) {
			return;
		}
		leadingDateMsRef.current = leadingDateMs;
		scheduleStickyDateSync();
	}, [leadingDateMs, scheduleStickyDateSync]);

	useLayoutEffect(() => {
		// Keep the reserved space through date-pill observer changes. Clearing it
		// temporarily shrinks the scroll range and clamps the browser's position.
		return () => {
			setStuckMarker(null);
			scrollElement?.style.removeProperty(STICKY_TOP_PROPERTY);
			scrollElement?.parentElement?.style.removeProperty(STICKY_TOP_PROPERTY);
			scrollElement?.style.removeProperty(TOP_OVERLAY_HEIGHT_PROPERTY);
		};
	}, [scrollElement, setStuckMarker]);

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
		if (datePillElement) {
			resizeObserver?.observe(datePillElement);
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
		datePillElement,
		topOverlayElement,
	]);

	return stickyDate;
}

function resolveDatePillHeightPx(datePillElement: HTMLDivElement | null) {
	const measuredHeight = datePillElement?.getBoundingClientRect().height ?? 0;
	return Number.isFinite(measuredHeight) && measuredHeight > 0
		? Math.ceil(measuredHeight)
		: DEFAULT_DATE_PILL_HEIGHT_PX;
}

function resolveMarkerActivationTop(input: {
	datePillHeightPx: number;
	markerHeightPx: number;
	scrollElement: HTMLElement;
}) {
	const scrollElementStyle = getComputedStyle(input.scrollElement);
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
	return (
		input.scrollElement.getBoundingClientRect().top +
		scrollPaddingTop +
		stickyTop +
		STICKY_DATE_TOP_OFFSET_PX +
		(input.datePillHeightPx - input.markerHeightPx) / 2
	);
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
