import { CENTER_AGENT_BOT_AVATAR_TYPES } from "@openmeld/schemas";
import { useSyncExternalStore } from "react";
import type { AgentAvatarStyle } from "../../src/components/agents/remote-agent-avatar";

// Same-origin demo frames share one tab-scoped identity, never a real Profile.
const key = "openmeld.website-demo.center-avatar";
const changed = "website-demo-center-avatar";
export function readDemoCenterAvatar(): AgentAvatarStyle {
	const value = sessionStorage.getItem(key);
	return value === "fluid" ||
		CENTER_AGENT_BOT_AVATAR_TYPES.some((type) => type === value)
		? (value as AgentAvatarStyle)
		: "cloud";
}
function subscribe(listener: () => void) {
	const storage = (event: StorageEvent) => {
		if (event.storageArea === sessionStorage && event.key === key) {
			listener();
		}
	};
	window.addEventListener("storage", storage);
	window.addEventListener(changed, listener);
	return () => {
		window.removeEventListener("storage", storage);
		window.removeEventListener(changed, listener);
	};
}
export function useDemoCenterAvatar() {
	const avatar = useSyncExternalStore(
		subscribe,
		readDemoCenterAvatar,
		() => "cloud" as const
	);
	return [
		avatar,
		(value: AgentAvatarStyle) => {
			sessionStorage.setItem(key, value);
			window.dispatchEvent(new Event(changed));
		},
	] as const;
}
