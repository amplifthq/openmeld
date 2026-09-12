import {
	createContext,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useMemo,
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

export function resolveSpaceReadingHeaderPosition(
	distance: number,
	compact = false
) {
	return compact ? distance > 1 : distance > 4;
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

	useLayoutEffect(() => {
		if (!header || input.isDirectMessage) {
			return;
		}
		return attachSpaceReadingHeader(
			header,
			input.view === "messages" ? scrollElement : null,
			state,
			storageKey
		);
	}, [
		header,
		input.isDirectMessage,
		input.view,
		scrollElement,
		state,
		storageKey,
	]);

	return (
		<SpaceReadingHeaderContext value={input.isDirectMessage ? null : value}>
			{input.children}
		</SpaceReadingHeaderContext>
	);
}

// Only endpoint changes write layout. Scroll events never measure title geometry,
// update animation progress, or rerender the transcript.
function attachSpaceReadingHeader(
	header: HTMLElement,
	scroller: HTMLElement | null,
	state: { compact: boolean },
	storageKey: string | undefined
) {
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
	let canCompact = false;
	let appliedCompact = false;
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
		if (
			header.querySelector('[data-slot="space-header-setup-recall-action"]') &&
			window.innerWidth < 1024
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
	const observer = new ResizeObserver(measure);
	observer.observe(header);
	observer.observe(navigation);
	for (const element of header.querySelectorAll(
		'[data-slot="space-window-header-leading"], [data-slot="space-window-header-actions"]'
	)) {
		observer.observe(element);
	}
	if (title.lastElementChild) {
		observer.observe(title.lastElementChild);
	}
	scroller?.addEventListener("scroll", onScroll, { passive: true });
	scroller?.addEventListener("wheel", startUserScroll, { passive: true });
	scroller?.addEventListener("touchmove", startUserScroll, { passive: true });
	scroller?.addEventListener("keydown", onKeyDown);
	scroller?.addEventListener("pointerdown", onPointerDown);
	measure();
	return () => {
		observer.disconnect();
		scroller?.removeEventListener("scroll", onScroll);
		scroller?.removeEventListener("wheel", startUserScroll);
		scroller?.removeEventListener("touchmove", startUserScroll);
		scroller?.removeEventListener("keydown", onKeyDown);
		scroller?.removeEventListener("pointerdown", onPointerDown);
		delete header.dataset.compact;
		frame.style.height = "";
	};
}
