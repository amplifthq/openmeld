import { desktopAuthIdentity } from "@openmeld/schemas";

export function resolveDesktopBrowserIdentity(input: {
	webOrigin: string;
	developmentTarget?: string;
	clientId: string;
}) {
	const url = new URL(input.webOrigin);
	const development =
		url.protocol === "http:" &&
		(url.hostname === "localhost" ||
			url.hostname === "127.0.0.1" ||
			url.hostname.endsWith(".localhost"));
	const identity = desktopAuthIdentity(!development, input.developmentTarget);
	if (input.clientId !== identity.clientId) {
		throw new Error(
			"This sign-in belongs to a different Desktop app. Start sign-in again from your app."
		);
	}
	return identity;
}
