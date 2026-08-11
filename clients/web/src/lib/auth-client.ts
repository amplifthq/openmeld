import { createAuthClientConfig } from "@openmeld/auth/client";
import { createAuthClient } from "better-auth/react";
import { env } from "#/env";

const LOCAL_WEB_APP_URL = "http://localhost:3000";

export function resolveDefaultOpenMeldAuthBaseUrl(): string {
	if (typeof window !== "undefined") {
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
