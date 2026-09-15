import { createAuthClientConfig } from "@openmeld/auth/client";
import { DESKTOP_APP_ORIGIN } from "@openmeld/schemas";
import { createAuthClient } from "better-auth/react";
import { env } from "#/env";

const LOCAL_WEB_APP_URL = "http://localhost:3000";

export function resolveDefaultOpenMeldAuthBaseUrl(): string {
	if (typeof window !== "undefined") {
		if (window.location.origin === DESKTOP_APP_ORIGIN) {
			// Shared modules initialize this HTTP client; Desktop session operations
			// use the native adapter and never send renderer credentials to this URL.
			if (!env.VITE_BETTER_AUTH_URL) {
				throw new Error("Desktop requires a configured Auth URL");
			}
			return env.VITE_BETTER_AUTH_URL;
		}
		return window.location.origin;
	}

	return env.WEB_APP_URL ?? LOCAL_WEB_APP_URL;
}

export function createOpenMeldAuthClient(baseURL: string) {
	return createAuthClient(
		createAuthClientConfig({
			baseURL,
		})
	);
}

export const openMeldAuthClient = createOpenMeldAuthClient(
	resolveDefaultOpenMeldAuthBaseUrl()
);

export type OpenMeldAuthClient = typeof openMeldAuthClient;
