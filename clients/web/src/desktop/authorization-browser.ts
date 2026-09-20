import type { DesktopPilotBridge } from "../../../desktop/src/shared/pilot-bridge";
import { getDesktopPlatform } from "./platform";

export type AuthorizationBrowser =
	| { kind: "desktop"; bridge: DesktopPilotBridge }
	| { kind: "web"; popup: Window };

export function prepareAuthorizationBrowser(
	name: string,
	features = "popup,width=720,height=760"
): AuthorizationBrowser | null {
	const bridge = getDesktopPlatform();
	if (bridge) {
		return { bridge, kind: "desktop" };
	}
	const popup = window.open("about:blank", name, features);
	if (!popup) {
		return null;
	}
	popup.opener = null;
	return { kind: "web", popup };
}

export async function openAuthorizationBrowser(
	browser: AuthorizationBrowser,
	href: string
): Promise<void> {
	if (browser.kind === "web") {
		if (browser.popup.closed) {
			throw new Error("The authorization window closed before setup started.");
		}
		browser.popup.location.href = href;
		browser.popup.focus();
		return;
	}
	const platform = await browser.bridge.platform();
	const url = new URL(href, platform.webOrigin);
	await browser.bridge.openExternal(url.href);
}

export function closeAuthorizationBrowser(
	browser: AuthorizationBrowser | null
): void {
	if (browser?.kind === "web") {
		browser.popup.close();
	}
}

export function authorizationBrowserClosed(
	browser: AuthorizationBrowser | null
): boolean {
	return browser?.kind === "web" ? browser.popup.closed : false;
}
