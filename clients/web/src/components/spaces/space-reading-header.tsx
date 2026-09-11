import {
	createContext,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import type { SpaceView } from "./space-view";

const SpaceReadingHeaderContext = createContext<{
	setHeader: (element: HTMLDivElement | null) => void;
	setScrollElement: (element: HTMLDivElement | null) => void;
} | null>(null);

export function useSpaceReadingHeader() {
	return useContext(SpaceReadingHeaderContext);
}

export function resolveSpaceReadingHeaderProgress(
	distanceFromBottom: number,
	isUserScrolling: boolean,
	anchor: { distance: number; progress: number } = { distance: 24, progress: 0 }
) {
	if (distanceFromBottom <= 24) {
		return 0;
	}
	if (distanceFromBottom >= 144) {
		return 1;
	}
	const anchorDistance = Math.min(144, Math.max(24, anchor.distance));
	// Interpolate from the resting position toward the relevant endpoint.
	// Resuming an upward gesture from a restored compact header must not first
	// send the tabs backwards to the absolute scroll position's partial progress.
	const progress =
		distanceFromBottom >= anchorDistance
			? anchor.progress +
				((1 - anchor.progress) * (distanceFromBottom - anchorDistance)) /
					(144 - anchorDistance)
			: (anchor.progress * (distanceFromBottom - 24)) / (anchorDistance - 24);
	// Restoring a reading position is not a partially completed gesture.
	return isUserScrolling ? progress : Math.round(progress);
}

export function SpaceReadingHeaderProvider(input: {
	children: ReactNode;
	isEmbedded: boolean;
	isDirectMessage: boolean;
	view: SpaceView;
}) {
	const [header, setHeader] = useState<HTMLDivElement | null>(null);
	const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
		null
	);
	const value = useMemo(() => ({ setHeader, setScrollElement }), []);
	const isSpace = !(input.isEmbedded || input.isDirectMessage);
	const enabled = isSpace && input.view === "messages";

	useLayoutEffect(() => {
		if (!(enabled && header && scrollElement)) {
			return;
		}
		return attachSpaceReadingHeader(header, scrollElement);
	}, [header, enabled, scrollElement]);

	return (
		<SpaceReadingHeaderContext value={isSpace ? value : null}>
			{input.children}
		</SpaceReadingHeaderContext>
	);
}

// The header owns these slots. The shared app frame supplies its outer header.
// Only the tab transform runs per frame. Changing the frame height
// once at each endpoint preserves the reading anchor without continuously
// resizing the message scroller, its virtual content, and the composer.
function attachSpaceReadingHeader(header: HTMLElement, scroller: HTMLElement) {
	const frame = header.closest("header");
	const title = header.querySelector<HTMLElement>(
		'[data-slot="space-window-header-title"]'
	);
	const navigation = header.querySelector<HTMLElement>(
		'[data-slot="space-window-header-navigation"]'
	);
	const secondary = header.querySelector<HTMLElement>(
		'[data-slot="space-window-header-secondary"]'
	);
	if (!(frame && title && navigation && secondary)) {
		return;
	}

	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	// Fixed tracks keep the title from shrinking along with the outer frame.
	header.style.gridTemplateRows =
		"var(--space-conversation-title-height) var(--space-conversation-navigation-height)";
	const expandedHeight = frame.getBoundingClientRect().height;
	const frameBorderHeight = frame.offsetHeight - frame.clientHeight;
	let animationFrame = 0;
	let compact = false;
	let canCompact = false;
	let offsetX = 0;
	let offsetY = 0;
	let titleHeight = 0;
	let navigationHeight = 0;
	let isUserScrolling = false;
	let lastProgress = 0;
	let gestureAnchor = { distance: 24, progress: 0 };
	const readDistance = () =>
		Math.max(
			0,
			scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
		);

	const setCompact = (next: boolean) => {
		if (compact === next) {
			return;
		}
		const previousTop = scroller.scrollTop;
		compact = next;
		const compactHeight = titleHeight + frameBorderHeight;
		const heightDifference = expandedHeight - compactHeight;
		frame.style.height = next ? `${compactHeight}px` : "";
		// The top edge moves while the composer remains at the bottom. Offset
		// scrollTop by that same distance so the message under the eye stays put.
		scroller.scrollTop = Math.max(
			0,
			previousTop + (next ? -heightDifference : heightDifference)
		);
	};

	const render = () => {
		animationFrame = 0;
		const distance = readDistance();
		const progress = canCompact
			? resolveSpaceReadingHeaderProgress(
					distance,
					isUserScrolling,
					gestureAnchor
				)
			: 0;
		lastProgress = progress;
		setCompact(progress === 1);
		if (reducedMotion.matches) {
			navigation.style.transform = compact
				? `translate(${offsetX}px, ${offsetY}px)`
				: "";
			return;
		}
		// Both axes share the scroll progress for a straight path to the anchor.
		navigation.style.transform = progress
			? `translate(${offsetX * progress}px, ${offsetY * progress}px)`
			: "";
	};

	const schedule = () => {
		if (!animationFrame) {
			animationFrame = requestAnimationFrame(render);
		}
	};
	const startUserScroll = () => {
		if (!isUserScrolling) {
			gestureAnchor = { distance: readDistance(), progress: lastProgress };
		}
		isUserScrolling = true;
	};
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
			startUserScroll();
		}
	};
	const onPointerDown = (event: PointerEvent) => {
		// Include dragging the native scrollbar, without treating message clicks
		// or text selection as scroll gestures.
		if (
			event.clientX >=
			scroller.getBoundingClientRect().left + scroller.clientWidth
		) {
			startUserScroll();
		}
	};
	const settle = () => {
		if (isUserScrolling) {
			const distance = readDistance();
			gestureAnchor = {
				distance,
				progress: Math.round(
					resolveSpaceReadingHeaderProgress(distance, true, gestureAnchor)
				),
			};
		}
		isUserScrolling = false;
		schedule();
	};

	const measure = () => {
		// Measure only on geometry changes, never in the scroll callback.
		title.style.maxWidth = "";
		const availableWidth = title.clientWidth;
		const tabWidth = navigation.offsetWidth;
		const adornment = title.lastElementChild;
		const adornmentWidth = adornment?.getBoundingClientRect().width ?? 0;
		// Reserve room for another ordinary tab even before one is present.
		const reservedNavigationWidth = Math.max(tabWidth, 240);
		const titleWidth = availableWidth - reservedNavigationWidth - 24;
		titleHeight = title.offsetHeight;
		navigationHeight = secondary.offsetHeight;
		// Narrow windows and the mobile setup recall keep their existing two rows.
		canCompact =
			titleWidth >= adornmentWidth + 96 &&
			!(
				header.querySelector(
					'[data-slot="space-header-setup-recall-action"]'
				) && window.innerWidth < 1024
			);
		if (canCompact) {
			title.style.maxWidth = `${titleWidth}px`;
			const end = title.lastElementChild?.getBoundingClientRect().right ?? 0;
			// offsetLeft is unaffected by our transform from the previous frame.
			const origin =
				header.getBoundingClientRect().left + navigation.offsetLeft;
			offsetX = end + 16 - origin;
			offsetY = -(titleHeight + navigationHeight) / 2;
		}
		schedule();
	};

	const resizeObserver = new ResizeObserver(measure);
	// Observe widths/content, not the frame whose height we deliberately change.
	resizeObserver.observe(header);
	resizeObserver.observe(navigation);
	if (title.firstElementChild) {
		resizeObserver.observe(title.firstElementChild);
	}
	if (title.lastElementChild) {
		resizeObserver.observe(title.lastElementChild);
	}
	const mutationObserver = new MutationObserver(measure);
	mutationObserver.observe(header, {
		childList: true,
		characterData: true,
		subtree: true,
	});
	scroller.addEventListener("scroll", schedule, { passive: true });
	scroller.addEventListener("scrollend", settle);
	scroller.addEventListener("wheel", startUserScroll, { passive: true });
	scroller.addEventListener("touchmove", startUserScroll, { passive: true });
	scroller.addEventListener("keydown", onKeyDown);
	scroller.addEventListener("pointerdown", onPointerDown);
	const viewportObserver = new ResizeObserver(schedule);
	viewportObserver.observe(scroller);
	reducedMotion.addEventListener("change", schedule);
	measure();

	return () => {
		cancelAnimationFrame(animationFrame);
		resizeObserver.disconnect();
		viewportObserver.disconnect();
		mutationObserver.disconnect();
		scroller.removeEventListener("scroll", schedule);
		scroller.removeEventListener("scrollend", settle);
		scroller.removeEventListener("wheel", startUserScroll);
		scroller.removeEventListener("touchmove", startUserScroll);
		scroller.removeEventListener("keydown", onKeyDown);
		scroller.removeEventListener("pointerdown", onPointerDown);
		reducedMotion.removeEventListener("change", schedule);
		setCompact(false);
		header.style.gridTemplateRows = "";
		title.style.maxWidth = "";
		navigation.style.transform = "";
	};
}
