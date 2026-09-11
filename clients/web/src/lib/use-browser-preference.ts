import { useSyncExternalStore } from "react";
import {
	readBrowserPreference,
	writeBrowserPreference,
} from "./spaces/browser-preference-storage";

const eventName = "openmeld:browser-preference";
function subscribe(listener: () => void) {
	window.addEventListener("storage", listener);
	window.addEventListener(eventName, listener);
	return () => {
		window.removeEventListener("storage", listener);
		window.removeEventListener(eventName, listener);
	};
}

export function useBrowserPreference(key: string) {
	const value = useSyncExternalStore(
		subscribe,
		() => readBrowserPreference(key),
		() => null
	);
	return [
		value,
		(next: string) => {
			writeBrowserPreference(key, next);
			window.dispatchEvent(new Event(eventName));
		},
	] as const;
}
