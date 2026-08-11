import { useMessageScroller } from "@shadcn/react/message-scroller";
import { useEffect, useRef } from "react";

export function SpaceConversationSendScrollController(input: {
	isSendingMessage: boolean;
}) {
	const { scrollToEnd } = useMessageScroller();
	const wasSendingMessageRef = useRef(input.isSendingMessage);

	useEffect(() => {
		const sendStarted = input.isSendingMessage && !wasSendingMessageRef.current;
		wasSendingMessageRef.current = input.isSendingMessage;

		if (sendStarted) {
			scrollToEnd({ behavior: "auto" });
		}
	}, [input.isSendingMessage, scrollToEnd]);

	return null;
}
