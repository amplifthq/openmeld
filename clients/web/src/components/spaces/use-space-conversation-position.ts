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

function getVisibleTop(viewport: HTMLDivElement): number {
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

function resolvePosition(
	viewport: HTMLDivElement,
	elements: ReadonlyMap<string, HTMLElement>
): SpaceConversationPosition | null {
	const top = getVisibleTop(viewport);
	const bottom = viewport.getBoundingClientRect().bottom;
	// Ref registration order is not timeline order after older pages are prepended.
	let first: SpaceConversationPosition | null = null;
	for (const [anchorSignalId, element] of elements) {
		const bounds = element.getBoundingClientRect();
		if (
			bounds.bottom > top &&
			bounds.top < bottom &&
			(!first || bounds.top - top < first.offsetFromVisibleTop)
		) {
			first = { anchorSignalId, offsetFromVisibleTop: bounds.top - top };
		}
	}
	return first;
}

export function useSpaceConversationPosition(input: {
	historyIsPending: boolean;
	hasEarlierHistory: boolean;
	isLoadingEarlierHistory: boolean;
	historyVersion: unknown;
	onLoadEarlierHistory: () => Promise<void>;
	historyError: string | null;
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: A remounted viewport must read the position saved by its previous instance.
	const rememberedPosition = useMemo(
		() => readSpaceConversationPosition(positionKey),
		[positionKey, input.viewport]
	);
	const shouldRestore =
		!input.hasExplicitFocus && Boolean(rememberedPosition || routerEntry);
	const saveRef = useRef<() => void>(() => undefined);
	const releaseRef = useRef<() => void>(() => undefined);
	const loadingRef = useRef(false);
	const releasedKeyRef = useRef<string | null>(null);
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const [followingViewport, setFollowingViewport] =
		useState<HTMLDivElement | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: New history mounts new message elements which must be measured and observed.
	useLayoutEffect(() => {
		const viewport = input.viewport;
		if (!viewport) {
			return;
		}
		if (viewportRef.current !== viewport) {
			viewportRef.current = viewport;
			releasedKeyRef.current = null;
		}
		let disposed = false;
		let frame = 0;
		let ready = false;
		let protectedAnchor =
			shouldRestore && releasedKeyRef.current !== positionKey;
		const save = () => {
			if (!ready || input.historyIsPending || protectedAnchor) {
				return;
			}
			const position = resolvePosition(
				viewport,
				input.messageElementsRef.current
			);
			if (position) {
				writeSpaceConversationPosition(positionKey, position);
			}
		};
		saveRef.current = save;
		const requestEarlierHistory = () => {
			if (
				input.isLoadingEarlierHistory ||
				loadingRef.current ||
				input.historyError
			) {
				return;
			}
			loadingRef.current = true;
			input
				.onLoadEarlierHistory()
				.catch((error: unknown) => {
					console.error(
						"Failed to load the saved Space reading position.",
						error
					);
				})
				.finally(() => {
					loadingRef.current = false;
				});
		};
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
			const waitingForAnchor = Boolean(rememberedPosition && !anchor);
			const canLoadAnchor =
				input.hasEarlierHistory || input.isLoadingEarlierHistory;
			if (waitingForAnchor && canLoadAnchor) {
				requestEarlierHistory();
				return;
			}
			alignReadingPosition(
				viewport,
				anchor,
				rememberedPosition,
				ready ? undefined : routerEntry?.scrollY
			);
			ready = true;
		};
		const schedule = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(restore);
		};
		const release = () => {
			protectedAnchor = false;
			releasedKeyRef.current = positionKey;
			ready = !input.historyIsPending;
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
		const observer = new ResizeObserver(schedule);
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
		schedule();
		return () => {
			save();
			disposed = true;
			window.cancelAnimationFrame(frame);
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
		input.hasEarlierHistory,
		input.isLoadingEarlierHistory,
		input.historyVersion,
		input.onLoadEarlierHistory,
		input.historyError,
		input.messageElementsRef,
		positionKey,
		rememberedPosition,
		routerEntry,
		shouldRestore,
	]);

	const save = useCallback(
		(viewport: HTMLDivElement) => {
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
	const followLatest = useCallback(() => {
		releaseRef.current();
		setFollowingViewport(input.viewport);
	}, [input.viewport]);
	return {
		followLatest,
		autoScroll:
			!shouldRestore ||
			(input.viewport !== null && followingViewport === input.viewport),
		defaultScrollPosition: shouldRestore
			? ("start" as const)
			: ("end" as const),
		onScroll: save,
		onScrollEnd: save,
	};
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
			getVisibleTop(viewport) -
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
