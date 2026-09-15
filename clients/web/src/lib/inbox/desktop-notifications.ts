import { getDesktopPlatform } from "#/desktop/platform";

export const DESKTOP_NOTIFICATION_SETTINGS_EVENT =
	"openmeld:desktop-notifications-changed";

export function readDesktopNotificationPreference(
	userId: string,
	field: "enabled" | "sound"
): boolean {
	return (
		window.localStorage.getItem(
			`openmeld.inbox.desktop-notifications.${field}:${encodeURIComponent(userId)}`
		) !== "disabled"
	);
}

export function writeDesktopNotificationPreference(
	userId: string,
	field: "enabled" | "sound",
	enabled: boolean
): void {
	window.localStorage.setItem(
		`openmeld.inbox.desktop-notifications.${field}:${encodeURIComponent(userId)}`,
		enabled ? "enabled" : "disabled"
	);
	window.dispatchEvent(new Event(DESKTOP_NOTIFICATION_SETTINGS_EVENT));
}

export async function isNotificationConversationVisible(): Promise<boolean> {
	const desktop = getDesktopPlatform();
	return desktop
		? await desktop.notificationFocused()
		: document.visibilityState === "visible";
}
