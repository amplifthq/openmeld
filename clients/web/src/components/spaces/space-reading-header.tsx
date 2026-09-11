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
	const enabled =
		!(input.isEmbedded || input.isDirectMessage) && input.view === "messages";

	useLayoutEffect(() => {
		if (!(enabled && header && scrollElement)) {
			return;
		}
		return attachSpaceReadingHeader(header, scrollElement);
	}, [header, enabled, scrollElement]);

	return (
		<SpaceReadingHeaderContext value={value}>
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
		const distance = Math.max(
			0,
			scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
		);
		const progress = canCompact
			? Math.min(1, Math.max(0, (distance - 24) / 120))
			: 0;
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

	const measure = () => {
		// Measure only on geometry changes, never in the scroll callback.
		title.style.maxWidth = "";
		const availableWidth = title.clientWidth;
		const tabWidth = navigation.offsetWidth;
		const adornment = title.lastElementChild;
		const adornmentWidth = adornment?.getBoundingClientRect().width ?? 0;
		const titleWidth = availableWidth - tabWidth - 24;
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
		reducedMotion.removeEventListener("change", schedule);
		setCompact(false);
		header.style.gridTemplateRows = "";
		title.style.maxWidth = "";
		navigation.style.transform = "";
	};
}
