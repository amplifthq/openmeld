import { useMessageScroller } from "@shadcn/react/message-scroller";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { getSpaceConversationVisibleTop } from "./use-space-conversation-position";

export type SpaceMessageScrollAction = ReturnType<
	typeof useMessageScroller
>["scrollToMessage"];

export function getSpaceMessageJumpSpacer(
	scrollElement: HTMLElement
): HTMLElement | null {
	const spacer = scrollElement.querySelector<HTMLElement>(
		"[data-message-scroller-spacer]"
	);
	return spacer && Number.parseFloat(spacer.style.height) > 0 ? spacer : null;
}

function getNaturalEndScrollTop(
	scrollElement: HTMLElement,
	spacer: HTMLElement
): number {
	const spacerStyle = getComputedStyle(spacer);
	const marginTop = Number.parseFloat(spacerStyle.marginTop) || 0;
	return Math.max(
		0,
		scrollElement.scrollHeight -
			scrollElement.clientHeight -
			spacer.offsetHeight -
			marginTop
	);
}

function scrollDirectionForKey(event: KeyboardEvent): number {
	if (event.key === " ") {
		return event.shiftKey ? -1 : 1;
	}
	if (["ArrowDown", "PageDown", "End"].includes(event.key)) {
		return 1;
	}
	if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
		return -1;
	}
	return 0;
}

export function scrollMessageIntoConversationViewport(input: {
	messageElement: HTMLElement;
	/** Place the message this far below the visible top instead of centering. */
	offsetFromVisibleTop?: number;
	scrollElement: HTMLElement;
}): void {
	const requestedOffset = input.offsetFromVisibleTop;
	const alignMessage = () => {
		const messageRect = input.messageElement.getBoundingClientRect();
		const viewportRect = input.scrollElement.getBoundingClientRect();
		// Rects are in screen pixels; scrollTop is in layout pixels.
		const scale =
			input.scrollElement.offsetHeight > 0 && viewportRect.height > 0
				? viewportRect.height / input.scrollElement.offsetHeight
				: 1;
		if (!(scale > 0)) {
			return;
		}
		if (requestedOffset !== undefined && Number.isFinite(requestedOffset)) {
			input.scrollElement.scrollTop +=
				(messageRect.top -
					getSpaceConversationVisibleTop(
						input.scrollElement as HTMLDivElement
					) -
					requestedOffset) /
				scale;
			return;
		}
		const offset =
			messageRect.height > viewportRect.height
				? messageRect.top - viewportRect.top - 64 * scale
				: (messageRect.top +
						messageRect.bottom -
						viewportRect.top -
						viewportRect.bottom) /
					2;
		input.scrollElement.scrollTop += offset / scale;
	};
	alignMessage();
	window.requestAnimationFrame(() =>
		window.requestAnimationFrame(alignMessage)
	);
}

// Explicit jumps must enter the scroller's jump mode before adjusting DOM
// coordinates; otherwise its resize observer can keep following the bottom.
export function SpaceMessageScrollController(input: {
	actionRef: RefObject<SpaceMessageScrollAction | null>;
	latestNavigationRequest?: number;
	latestMessageId?: string | null;
	scrollElement?: HTMLElement | null;
}) {
	const { scrollToEnd, scrollToMessage, scrollToStart } = useMessageScroller();
	const previousLatestMessageIdRef = useRef(input.latestMessageId);
	const previousLatestNavigationRequest = useRef(input.latestNavigationRequest);
	useLayoutEffect(() => {
		if (
			previousLatestNavigationRequest.current === input.latestNavigationRequest
		) {
			return;
		}
		previousLatestNavigationRequest.current = input.latestNavigationRequest;
		// Run after the requested history window commits, through the scroller's
		// owner so an earlier explicit jump/spacer cannot retain the old viewport.
		scrollToEnd({ behavior: "auto" });
	}, [input.latestNavigationRequest, scrollToEnd]);
	useLayoutEffect(() => {
		input.actionRef.current = scrollToMessage;
		return () => {
			input.actionRef.current = null;
		};
	}, [input.actionRef, scrollToMessage]);
	useEffect(() => {
		const scrollElement = input.scrollElement;
		if (!scrollElement) {
			return;
		}
		const root = scrollElement.closest<HTMLElement>(
			'[data-slot="message-scroller"]'
		);
		if (!root) {
			return;
		}
		let frame = 0;
		let touchY: number | null = null;
		let pointerDown = false;
		let previousScrollTop = scrollElement.scrollTop;
		const releaseAfterUserScroll = (direction: number) => {
			const spacer = getSpaceMessageJumpSpacer(scrollElement);
			if (!(spacer && direction)) {
				return;
			}
			const naturalEnd = getNaturalEndScrollTop(scrollElement, spacer);
			if (direction > 0 && scrollElement.scrollTop >= naturalEnd - 1) {
				// Scrolling farther into reserved space means returning to the real tail.
				scrollToEnd({ behavior: "auto" });
			} else if (direction < 0 && scrollElement.scrollTop <= naturalEnd) {
				// Only remove the spacer once the same reading position exists without it.
				const scrollTop = scrollElement.scrollTop;
				scrollToStart({ behavior: "auto" });
				scrollElement.scrollTop = scrollTop;
			}
			previousScrollTop = scrollElement.scrollTop;
		};
		const scheduleRelease = (direction: number) => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(() => {
				frame = 0;
				releaseAfterUserScroll(direction);
			});
		};
		const onWheel = (event: WheelEvent) => {
			if (event.deltaY) {
				scheduleRelease(event.deltaY);
			}
		};
		const onTouchStart = (event: TouchEvent) => {
			touchY = event.touches[0]?.clientY ?? null;
		};
		const onTouchMove = (event: TouchEvent) => {
			const nextY = event.touches[0]?.clientY;
			if (nextY !== undefined && touchY !== null && nextY !== touchY) {
				scheduleRelease(touchY - nextY);
			}
			touchY = nextY ?? null;
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.target instanceof HTMLElement)) {
				return;
			}
			if (
				!scrollElement.contains(event.target) ||
				event.target.closest(
					'button, input, textarea, [contenteditable="true"]'
				)
			) {
				return;
			}
			const direction = scrollDirectionForKey(event);
			if (direction) {
				scheduleRelease(direction);
			}
		};
		const onScroll = () => {
			const scrollTop = scrollElement.scrollTop;
			if (pointerDown && scrollTop !== previousScrollTop) {
				scheduleRelease(scrollTop - previousScrollTop);
			}
			previousScrollTop = scrollTop;
		};
		const onPointerDown = () => {
			pointerDown = true;
			previousScrollTop = scrollElement.scrollTop;
		};
		const onPointerUp = () => {
			pointerDown = false;
		};
		root.addEventListener("wheel", onWheel, { passive: true });
		root.addEventListener("touchstart", onTouchStart, { passive: true });
		root.addEventListener("touchmove", onTouchMove, { passive: true });
		root.addEventListener("keydown", onKeyDown);
		root.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointerup", onPointerUp);
		scrollElement.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			window.cancelAnimationFrame(frame);
			root.removeEventListener("wheel", onWheel);
			root.removeEventListener("touchstart", onTouchStart);
			root.removeEventListener("touchmove", onTouchMove);
			root.removeEventListener("keydown", onKeyDown);
			root.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointerup", onPointerUp);
			scrollElement.removeEventListener("scroll", onScroll);
		};
	}, [input.scrollElement, scrollToEnd, scrollToStart]);
	useLayoutEffect(() => {
		const previous = previousLatestMessageIdRef.current;
		previousLatestMessageIdRef.current = input.latestMessageId;
		if (
			!(previous && input.latestMessageId) ||
			previous === input.latestMessageId
		) {
			return;
		}
		if (input.scrollElement && getSpaceMessageJumpSpacer(input.scrollElement)) {
			// A jump near the tail can leave artificial space below the focused
			// message. Once a new tail arrives, show it and release that space.
			scrollToEnd({ behavior: "auto" });
		}
	}, [input.latestMessageId, input.scrollElement, scrollToEnd]);
	return null;
}

export function SpaceConversationSendScrollController(input: {
	isSendingMessage: boolean;
	onSendStart: () => void;
}) {
	const { scrollToEnd } = useMessageScroller();
	const wasSendingMessageRef = useRef(input.isSendingMessage);

	useEffect(() => {
		const sendStarted = input.isSendingMessage && !wasSendingMessageRef.current;
		wasSendingMessageRef.current = input.isSendingMessage;

		if (sendStarted) {
			input.onSendStart();
			scrollToEnd({ behavior: "auto" });
		}
	}, [input.isSendingMessage, input.onSendStart, scrollToEnd]);

	return null;
}
