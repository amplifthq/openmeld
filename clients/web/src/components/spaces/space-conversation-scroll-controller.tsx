import { useMessageScroller } from "@shadcn/react/message-scroller";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

export type SpaceMessageScrollAction = ReturnType<
	typeof useMessageScroller
>["scrollToMessage"];

export function scrollMessageIntoConversationViewport(input: {
	messageElement: HTMLElement;
	scrollElement: HTMLElement;
}): void {
	const alignMessage = () => {
		const messageRect = input.messageElement.getBoundingClientRect();
		const viewportRect = input.scrollElement.getBoundingClientRect();
		const scale =
			input.scrollElement.offsetHeight > 0 && viewportRect.height > 0
				? viewportRect.height / input.scrollElement.offsetHeight
				: 1;
		const offset =
			messageRect.height > viewportRect.height
				? messageRect.top - viewportRect.top - 64 * scale
				: (messageRect.top +
						messageRect.bottom -
						viewportRect.top -
						viewportRect.bottom) /
					2;
		if (scale > 0) {
			input.scrollElement.scrollTop += offset / scale;
		}
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
}) {
	const { scrollToMessage } = useMessageScroller();
	useLayoutEffect(() => {
		input.actionRef.current = scrollToMessage;
		return () => {
			input.actionRef.current = null;
		};
	}, [input.actionRef, scrollToMessage]);
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
