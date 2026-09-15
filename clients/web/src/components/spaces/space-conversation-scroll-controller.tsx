import { useMessageScroller } from "@shadcn/react/message-scroller";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

export type SpaceMessageScrollAction = ReturnType<
	typeof useMessageScroller
>["scrollToMessage"];

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
