import {
	createContext,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import { z } from "zod/v4";
import {
	readBrowserPreference,
	removeBrowserPreference,
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

const positionSchema = z
	.object({
		compact: z.boolean(),
		progress: z.number().min(0).max(1),
		anchor: z.object({
			distance: z.number().min(24).max(143),
			progress: z.number().min(0).max(1),
		}),
	})
	.refine((position) => !position.compact || position.progress === 1);
type SpaceReadingHeaderPosition = z.infer<typeof positionSchema>;

export function readSpaceReadingHeaderPosition(storageKey: string) {
	const raw = readBrowserPreference(storageKey);
	if (raw === null) {
		return undefined;
	}
	try {
		const result = positionSchema.safeParse(JSON.parse(raw));
		if (result.success) {
			return result.data;
		}
	} catch {
		// A malformed preference is not a usable reading position.
	}
	console.warn("Ignoring invalid Space reading header preference.", {
		storageKey,
	});
	removeBrowserPreference(storageKey);
	return undefined;
}

export function spaceReadingHeaderStorageKey(input: {
	organizationSlug: string;
	profileId: string;
	spaceId: string;
}) {
	return `openmeld.space.reading-header.v1:${JSON.stringify([
		input.organizationSlug,
		input.profileId,
		input.spaceId,
	])}`;
}

export function resolveSpaceReadingHeaderPosition(
	distance: number,
	previous: SpaceReadingHeaderPosition = {
		compact: false,
		progress: 0,
		anchor: { distance: 24, progress: 0 },
	}
): SpaceReadingHeaderPosition {
	if (distance <= 24) {
		return {
			compact: false,
			progress: 0,
			anchor: { distance: 24, progress: 0 },
		};
	}
	if (distance >= 144 || (previous.compact && distance >= 72)) {
		return {
			compact: true,
			progress: 1,
			anchor: { distance: 72, progress: 1 },
		};
	}
	// Separate collapse and expansion boundaries prevent a tiny reversal from
	// repeatedly resizing the viewport. The tabs leave the compact anchor
	// continuously once the reader approaches the latest messages.
	const anchor = previous.anchor;
	const progress =
		distance >= anchor.distance
			? anchor.progress +
				((1 - anchor.progress) * (distance - anchor.distance)) /
					(144 - anchor.distance)
			: (anchor.progress * (distance - 24)) / (anchor.distance - 24);
	return { compact: false, progress, anchor };
}

export function SpaceReadingHeaderProvider(input: {
	children: ReactNode;
	isEmbedded: boolean;
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
	const isSpace = !(input.isEmbedded || input.isDirectMessage);
	const storageKey = input.organizationSlug
		? spaceReadingHeaderStorageKey({
				...input,
				organizationSlug: input.organizationSlug,
			})
		: undefined;
	const state = useMemo<{
		storageKey: string | undefined;
		position?: SpaceReadingHeaderPosition;
	}>(() => ({ storageKey }), [storageKey]);

	useLayoutEffect(() => {
		if (!(isSpace && header)) {
			return;
		}
		state.position ??=
			(storageKey ? readSpaceReadingHeaderPosition(storageKey) : undefined) ??
			resolveSpaceReadingHeaderPosition(0);
		return attachSpaceReadingHeader(
			header,
			input.view === "messages" ? scrollElement : null,
			state
		);
	}, [header, isSpace, input.view, scrollElement, state, storageKey]);

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
function attachSpaceReadingHeader(
	header: HTMLElement,
	scroller: HTMLElement | null,
	state: {
		position?: SpaceReadingHeaderPosition;
		storageKey: string | undefined;
	}
) {
	const { storageKey } = state;
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
	let hasUserScrolled = false;
	let lastSaved: string | undefined;
	const readDistance = () =>
		scroller
			? Math.max(
					0,
					scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
				)
			: 0;
	const save = () => {
		if (!(storageKey && state.position)) {
			return;
		}
		const serialized = JSON.stringify(state.position);
		if (serialized !== lastSaved) {
			writeBrowserPreference(storageKey, serialized);
			lastSaved = serialized;
		}
	};

	const setCompact = (next: boolean) => {
		if (compact === next) {
			return;
		}
		const previousTop = scroller?.scrollTop ?? 0;
		compact = next;
		const compactHeight = titleHeight + frameBorderHeight;
		const heightDifference = expandedHeight - compactHeight;
		frame.style.height = next ? `${compactHeight}px` : "";
		// The top edge moves while the composer remains at the bottom. Offset
		// scrollTop by that same distance so the message under the eye stays put.
		if (scroller) {
			scroller.scrollTop = Math.max(
				0,
				previousTop + (next ? -heightDifference : heightDifference)
			);
		}
	};

	const render = () => {
		animationFrame = 0;
		if (canCompact && scroller && hasUserScrolled) {
			state.position = resolveSpaceReadingHeaderPosition(
				readDistance(),
				state.position
			);
		}
		const progress = canCompact ? (state.position?.progress ?? 0) : 0;
		setCompact(canCompact && (state.position?.compact ?? false));
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
	const finishScroll = () => {
		if (animationFrame) {
			cancelAnimationFrame(animationFrame);
			render();
		}
		save();
	};
	// View changes and scroll restoration do not move the navigation. Resume
	// from the saved visual position when the reader next scrolls Messages.
	const startUserScroll = () => {
		if (!hasUserScrolled && state.position) {
			state.position.anchor = {
				distance: Math.min(143, Math.max(24, readDistance())),
				progress: state.position.progress,
			};
		}
		hasUserScrolled = true;
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (
			scroller &&
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
		if (
			scroller &&
			event.clientX >=
				scroller.getBoundingClientRect().left + scroller.clientWidth
		) {
			startUserScroll();
		}
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
	scroller?.addEventListener("scroll", schedule, { passive: true });
	scroller?.addEventListener("scrollend", finishScroll);
	scroller?.addEventListener("wheel", startUserScroll, { passive: true });
	scroller?.addEventListener("touchmove", startUserScroll, { passive: true });
	scroller?.addEventListener("keydown", onKeyDown);
	scroller?.addEventListener("pointerdown", onPointerDown);
	window.addEventListener("pagehide", finishScroll);
	const viewportObserver = new ResizeObserver(schedule);
	if (scroller) {
		viewportObserver.observe(scroller);
	}
	reducedMotion.addEventListener("change", schedule);
	measure();
	// Restore geometry before paint, including Files where no scroller exists.
	cancelAnimationFrame(animationFrame);
	render();

	return () => {
		save();
		cancelAnimationFrame(animationFrame);
		resizeObserver.disconnect();
		viewportObserver.disconnect();
		mutationObserver.disconnect();
		scroller?.removeEventListener("scroll", schedule);
		scroller?.removeEventListener("scrollend", finishScroll);
		scroller?.removeEventListener("wheel", startUserScroll);
		scroller?.removeEventListener("touchmove", startUserScroll);
		scroller?.removeEventListener("keydown", onKeyDown);
		scroller?.removeEventListener("pointerdown", onPointerDown);
		window.removeEventListener("pagehide", finishScroll);
		reducedMotion.removeEventListener("change", schedule);
		setCompact(false);
		header.style.gridTemplateRows = "";
		title.style.maxWidth = "";
		navigation.style.transform = "";
	};
}
