import { useMessageScroller } from "@shadcn/react/message-scroller";
import { useEffect, useRef } from "react";

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
