import { useBrowserPreference } from "#/lib/use-browser-preference";
import { readBrowserPreference } from "./browser-preference-storage";

const STORAGE_KEY = "openmeld.space.message-send-shortcut";
export type MessageSendShortcut = "enter" | "modifier-enter";

export function readMessageSendShortcutPreference(): MessageSendShortcut {
	return readBrowserPreference(STORAGE_KEY) === "modifier-enter"
		? "modifier-enter"
		: "enter";
}

export function useMessageSendShortcut() {
	const [stored, write] = useBrowserPreference(STORAGE_KEY);
	const shortcut: MessageSendShortcut =
		stored === "modifier-enter" ? "modifier-enter" : "enter";
	return {
		shortcut,
		setShortcut: (value: MessageSendShortcut) => write(value),
	};
}

/** Shared by the rich editor and its plain-text recovery input. */
export function resolveMessageEnterAction(
	event: Pick<
		KeyboardEvent,
		"key" | "isComposing" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
	>,
	shortcut: MessageSendShortcut
): "send" | "newline" | null {
	if (event.isComposing || event.key !== "Enter") {
		return null;
	}
	if (event.shiftKey) {
		return "newline";
	}
	if (shortcut === "enter") {
		return "send";
	}
	return (event.ctrlKey || event.metaKey) && !event.altKey ? "send" : "newline";
}
