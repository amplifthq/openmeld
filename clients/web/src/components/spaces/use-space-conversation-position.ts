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

const LATEST_THRESHOLD_PX = 12;
const TOP_OVERLAY_HEIGHT_PROPERTY = "--space-conversation-top-overlay-height";

function isScrolledToLatest(viewport: HTMLDivElement): boolean {
	return (
		viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <=
		LATEST_THRESHOLD_PX
	);
}

function getVisibleTop(viewport: HTMLDivElement): number {
	const overlayHeight = Number.parseFloat(
		window
			.getComputedStyle(viewport)
			.getPropertyValue(TOP_OVERLAY_HEIGHT_PROPERTY)
	);
	return (
		viewport.getBoundingClientRect().top +
		(Number.isFinite(overlayHeight) ? overlayHeight : 0)
	);
}

function resolvePosition(input: {
	messageElements: ReadonlyMap<string, HTMLElement>;
	viewport: HTMLDivElement;
}): SpaceConversationPosition | null {
	const viewportBounds = input.viewport.getBoundingClientRect();
	const visibleTop = getVisibleTop(input.viewport);
	for (const [anchorSignalId, messageElement] of input.messageElements) {
		const messageBounds = messageElement.getBoundingClientRect();
		if (
			messageBounds.bottom > visibleTop &&
			messageBounds.top < viewportBounds.bottom
		) {
			return {
				anchorSignalId,
				offsetFromVisibleTop: messageBounds.top - visibleTop,
			};
		}
	}
	return null;
}

export function useSpaceConversationPosition(input: {
	historyIsPending: boolean;
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
	const rememberedPosition = useMemo(
		() => readSpaceConversationPosition(positionKey),
		[positionKey]
	);
	const appliedPositionKeyRef = useRef<string | null>(null);
	const [restoredState, setRestoredState] = useState<{
		followLatest: boolean;
		id: string;
	} | null>(null);
	const autoScroll =
		restoredState?.id === input.restorationId
			? restoredState.followLatest
			: !rememberedPosition && routerEntry === undefined;

	useLayoutEffect(() => {
		if (!input.viewport || appliedPositionKeyRef.current === positionKey) {
			return;
		}
		const viewport = input.viewport;

		const restore = () => {
			const anchorElement = rememberedPosition
				? input.messageElementsRef.current.get(
						rememberedPosition.anchorSignalId
					)
				: undefined;
			if (rememberedPosition && !anchorElement && input.historyIsPending) {
				return false;
			}
			if (anchorElement && rememberedPosition) {
				const currentOffset =
					anchorElement.getBoundingClientRect().top - getVisibleTop(viewport);
				viewport.scrollTop +=
					currentOffset - rememberedPosition.offsetFromVisibleTop;
			} else if (routerEntry) {
				viewport.scrollLeft = routerEntry.scrollX;
				viewport.scrollTop = Math.min(
					routerEntry.scrollY,
					Math.max(0, viewport.scrollHeight - viewport.clientHeight)
				);
			}
			return true;
		};
		let settleFrame: number | null = null;
		const restoreFrame = window.requestAnimationFrame(() => {
			if (!restore()) {
				return;
			}
			settleFrame = window.requestAnimationFrame(() => {
				if (!restore()) {
					return;
				}
				appliedPositionKeyRef.current = positionKey;
				setRestoredState({
					followLatest: isScrolledToLatest(viewport),
					id: input.restorationId,
				});
			});
		});
		return () => {
			window.cancelAnimationFrame(restoreFrame);
			if (settleFrame !== null) {
				window.cancelAnimationFrame(settleFrame);
			}
		};
	}, [
		input.historyIsPending,
		input.messageElementsRef,
		input.restorationId,
		input.viewport,
		positionKey,
		rememberedPosition,
		routerEntry,
	]);

	const onScroll = useCallback(
		(viewport: HTMLDivElement) => {
			if (
				(rememberedPosition === null && routerEntry === undefined) ||
				autoScroll ||
				!isScrolledToLatest(viewport)
			) {
				return;
			}
			setRestoredState({ followLatest: true, id: input.restorationId });
		},
		[autoScroll, input.restorationId, rememberedPosition, routerEntry]
	);
	const onScrollEnd = useCallback(
		(viewport: HTMLDivElement) => {
			if (appliedPositionKeyRef.current !== positionKey) {
				return;
			}
			const position = resolvePosition({
				messageElements: input.messageElementsRef.current,
				viewport,
			});
			if (position) {
				writeSpaceConversationPosition(positionKey, position);
			}
		},
		[input.messageElementsRef, positionKey]
	);

	return { autoScroll, onScroll, onScrollEnd };
}
