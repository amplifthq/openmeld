import { useCallback, useSyncExternalStore } from "react";

export type ConversationView = "grouped" | "recent";
const CHANGE_EVENT = "openmeld:conversation-view";
function subscribe(listener: () => void) {
	window.addEventListener("storage", listener);
	window.addEventListener(CHANGE_EVENT, listener);
	return () => {
		window.removeEventListener("storage", listener);
		window.removeEventListener(CHANGE_EVENT, listener);
	};
}

export function useConversationView(userId: string, organizationId: string) {
	const key = `openmeld:conversation-view:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId)}`;
	const read = useCallback(
		(): ConversationView =>
			window.localStorage.getItem(key) === "grouped" ? "grouped" : "recent",
		[key]
	);
	const view = useSyncExternalStore(
		subscribe,
		read,
		(): ConversationView => "recent"
	);
	return {
		view,
		setView: (value: ConversationView) => {
			window.localStorage.setItem(key, value);
			window.dispatchEvent(new Event(CHANGE_EVENT));
		},
	};
}
