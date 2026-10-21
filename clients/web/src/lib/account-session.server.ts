import {
	createFetchTransport,
	createOpenMeldApiClient,
	readAccountSession,
} from "@openmeld/api-client";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getRequiredServerEnv } from "#/env";

export function readAccountSessionFromRequest(signal?: AbortSignal) {
	const cookie = getRequestHeaders().get("cookie");
	return readAccountSession(
		createOpenMeldApiClient({
			baseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
			transport: createFetchTransport({ fetch }),
			getAuthHeaders: async (): Promise<Record<string, string>> =>
				cookie ? { cookie } : {},
		}),
		{ signal }
	);
}
