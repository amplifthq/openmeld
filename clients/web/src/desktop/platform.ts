import { DESKTOP_APP_ORIGIN } from "@openmeld/schemas";
import { getBridge } from "../../../desktop/src/renderer/ipc";
import type { DesktopPilotBridge } from "../../../desktop/src/shared/pilot-bridge";

export function getDesktopPlatform(): DesktopPilotBridge | null {
	if (
		typeof window === "undefined" ||
		`${window.location.protocol}//${window.location.host}` !==
			DESKTOP_APP_ORIGIN
	) {
		return null;
	}
	if (!window.openmeldDesktop) {
		throw new Error(
			"Desktop could not start its secure connection. Quit and reopen the app."
		);
	}
	return window.openmeldDesktop;
}

export function openDesktopWeb(path: string): Promise<void> {
	if (!getDesktopPlatform()) {
		throw new Error("Open this action in Desktop.");
	}
	return getBridge().openWeb(path);
}
