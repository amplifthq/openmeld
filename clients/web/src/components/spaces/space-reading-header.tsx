import {
	createContext,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	readBrowserPreference,
	writeBrowserPreference,
} from "../../lib/spaces/browser-preference-storage";
import type { SpaceView } from "./space-view";

const SpaceReadingHeaderContext = createContext<{
	setHeader: (element: HTMLDivElement | null) => void;
	setScrollElement: (element: HTMLDivElement | null) => void;
} | null>(null);

export function useSpaceReadingHeader() {
	return useContext(SpaceReadingHeaderContext);
}

export function spaceReadingHeaderStorageKey(input: {
	organizationSlug: string;
	profileId: string;
	spaceId: string;
}) {
	return `openmeld.space.reading-header.v2:${JSON.stringify([input.organizationSlug, input.profileId, input.spaceId])}`;
}

// Distance from the latest messages, in CSS pixels. The wider gap prevents
// trackpad jitter from repeatedly changing the header near either endpoint.
const COMPACT_DISTANCE = 64;
const EXPAND_DISTANCE = 16;

export function resolveSpaceReadingHeaderPosition(
	distance: number,
	compact = false
) {
	return compact ? distance > EXPAND_DISTANCE : distance >= COMPACT_DISTANCE;
}

export function SpaceReadingHeaderProvider(input: {
	children: ReactNode;
	isDirectMessage: boolean;
	view: SpaceView;
	organizationSlug: string | undefined;
	profileId: string;
	spaceId: string;
}) {
	const [header, setHeader] = useState<HTMLDivElement | null>(null);
	const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
		null
	);
	const value = useMemo(() => ({ setHeader, setScrollElement }), []);
	const storageKey = input.organizationSlug
		? spaceReadingHeaderStorageKey({
				...input,
				organizationSlug: input.organizationSlug,
			})
		: undefined;
	const state = useMemo(
		() => ({
			compact: storageKey
				? readBrowserPreference(storageKey) === "compact"
				: false,
		}),
		[storageKey]
	);
	const activeScrollElement = input.view === "messages" ? scrollElement : null;
	const activeScrollElementRef = useRef(activeScrollElement);
	activeScrollElementRef.current = activeScrollElement;
	const controllerRef = useRef<SpaceReadingHeaderController | null>(null);

	// Layout measurement belongs to the header's lifetime. The Messages scroller
	// can be replaced independently without remeasuring transient view geometry.
	useLayoutEffect(() => {
		if (!header || input.isDirectMessage) {
			return;
		}
		const frame = header.closest("header");
		const controller = attachSpaceReadingHeader(header, state, storageKey);
		controllerRef.current = controller ?? null;
		controller?.setScrollElement(activeScrollElementRef.current);
		return () => {
			controller?.destroy();
			if (controllerRef.current === controller) {
				controllerRef.current = null;
			}
			delete header.dataset.compact;
			if (frame) {
				frame.style.height = "";
			}
		};
	}, [header, input.isDirectMessage, state, storageKey]);

	useLayoutEffect(() => {
		controllerRef.current?.setScrollElement(activeScrollElement);
	}, [activeScrollElement]);

	return (
		<SpaceReadingHeaderContext value={input.isDirectMessage ? null : value}>
			{input.children}
		</SpaceReadingHeaderContext>
	);
}

type SpaceReadingHeaderController = {
	destroy: () => void;
	setScrollElement: (element: HTMLElement | null) => void;
};

// Only endpoint changes write layout. Scroll events never measure title geometry,
// update animation progress, or rerender the transcript.
function attachSpaceReadingHeader(
	header: HTMLElement,
	state: { compact: boolean },
	storageKey: string | undefined
): SpaceReadingHeaderController | undefined {
	const frame = header.closest("header");
	const navigation = header.querySelector<HTMLElement>(
		'[data-slot="space-window-header-navigation"]'
	);
	const title = header.querySelector<HTMLElement>(
		'[data-slot="space-window-header-title"]'
	);
	if (!(frame && navigation && title)) {
		return;
	}
	let scroller: HTMLElement | null = null;
	let canCompact = false;
	let appliedCompact =
		header.dataset.compact === undefined
			? undefined
			: header.dataset.compact === "true";
	let userScrolled = false;
	const apply = () => {
		const next = canCompact && state.compact;
		if (next === appliedCompact) {
			return;
		}
		const previousTop = scroller?.scrollTop ?? 0;
		const previousHeight = scroller?.clientHeight ?? 0;
		appliedCompact = next;
		header.dataset.compact = String(next);
		frame.style.height = next
			? "calc(var(--space-conversation-title-height) + 1px)"
			: "";
		// A single viewport resize is offset once, keeping the reading anchor fixed.
		if (scroller) {
			scroller.scrollTop = Math.max(
				0,
				previousTop - (scroller.clientHeight - previousHeight)
			);
		}
	};
	const measure = () => {
		const leading = header.querySelector<HTMLElement>(
			'[data-slot="space-window-header-leading"]'
		);
		const actions = header.querySelector<HTMLElement>(
			'[data-slot="space-window-header-actions"]'
		);
		const adornment = title.lastElementChild as HTMLElement | null;
		const padding = Number.parseFloat(getComputedStyle(header).paddingLeft) * 2;
		// offsetWidth uses layout coordinates, including inside a scaled Desk.
		canCompact =
			header.clientWidth -
				padding -
				(leading?.offsetWidth ?? 0) -
				(actions?.offsetWidth ?? 0) -
				navigation.offsetWidth -
				(adornment?.offsetWidth ?? 0) -
				60 >=
			96;
		const narrowViewport =
			narrowViewportQuery?.matches ?? window.innerWidth < 1024;
		if (
			header.querySelector('[data-slot="space-header-setup-recall-action"]') &&
			narrowViewport
		) {
			canCompact = false;
		}
		apply();
	};
	const onScroll = () => {
		if (!(scroller && userScrolled)) {
			return;
		}
		const distance = Math.max(
			0,
			scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
		);
		const next = resolveSpaceReadingHeaderPosition(distance, state.compact);
		if (next === state.compact) {
			return;
		}
		state.compact = next;
		apply();
		if (storageKey) {
			writeBrowserPreference(storageKey, next ? "compact" : "expanded");
		}
	};
	const startUserScroll = () => {
		userScrolled = true;
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
		if (scroller && event.offsetX >= scroller.clientWidth) {
			startUserScroll();
		}
	};
	const removeScrollListeners = (element: HTMLElement) => {
		element.removeEventListener("scroll", onScroll);
		element.removeEventListener("wheel", startUserScroll);
		element.removeEventListener("touchmove", startUserScroll);
		element.removeEventListener("keydown", onKeyDown);
		element.removeEventListener("pointerdown", onPointerDown);
	};
	const setScrollElement = (element: HTMLElement | null) => {
		if (element === scroller) {
			return;
		}
		if (scroller) {
			removeScrollListeners(scroller);
		}
		scroller = element;
		userScrolled = false;
		scroller?.addEventListener("scroll", onScroll, { passive: true });
		scroller?.addEventListener("wheel", startUserScroll, { passive: true });
		scroller?.addEventListener("touchmove", startUserScroll, { passive: true });
		scroller?.addEventListener("keydown", onKeyDown);
		scroller?.addEventListener("pointerdown", onPointerDown);
	};
	const resizeObserver = new ResizeObserver(measure);
	resizeObserver.observe(header);
	resizeObserver.observe(navigation);
	for (const element of header.querySelectorAll(
		'[data-slot="space-window-header-leading"], [data-slot="space-window-header-actions"]'
	)) {
		resizeObserver.observe(element);
	}
	if (title.lastElementChild) {
		resizeObserver.observe(title.lastElementChild);
	}
	// The setup recall action is absolutely positioned below lg, so mounting or
	// removing it does not resize the observed action row. Observe membership as
	// the missing eligibility input instead of polling layout while scrolling.
	const mutationObserver = new MutationObserver(measure);
	mutationObserver.observe(header, { childList: true, subtree: true });
	const narrowViewportQuery =
		typeof window.matchMedia === "function"
			? window.matchMedia("(max-width: 1023px)")
			: null;
	narrowViewportQuery?.addEventListener("change", measure);
	measure();
	return {
		destroy: () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			narrowViewportQuery?.removeEventListener("change", measure);
			setScrollElement(null);
		},
		setScrollElement,
	};
}
