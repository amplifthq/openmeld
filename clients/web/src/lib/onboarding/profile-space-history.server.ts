import {
	buildProfileSpaceHistoryListPath,
	resolveProfileSpaceHistoryGatewayHost,
} from "@openmeld/api-client";
import { listProfileSpaceHistoryResponseSchema } from "@openmeld/schemas";
import type { ProfileSpaceHistoryRecord } from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { proxyOpenMeldGatewayRequest } from "#/lib/openmeld-api/proxy";
import { readJsonFromWebOpenMeldBoundary } from "#/lib/openmeld-api/server-read";

export async function readProfileSpaceHistory(input: {
	gatewayUrl: string;
	webAppUrl: string;
	requestHeaders: Headers;
	profileId: string;
	limit?: number;
	pinned?: boolean;
	fetchImpl?: typeof fetch;
	proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
}): Promise<readonly ProfileSpaceHistoryRecord[]> {
	const profileId = input.profileId.trim();
	if (profileId.length === 0) {
		throw new Error("Profile space history requires a profile ID.");
	}

	const payload = await readJsonFromWebOpenMeldBoundary({
		currentUserSessionExpectation: "required",
		gatewayUrl: input.gatewayUrl,
		invalidMessage: "Invalid selected profile spaces response",
		operation: "list selected profile spaces",
		path: buildProfileSpaceHistoryListPath({
			profileId,
			gatewayHost: resolveProfileSpaceHistoryGatewayHost(input.gatewayUrl),
			statuses: ["active"],
			limit: input.limit ?? 40,
			...(input.pinned === undefined ? {} : { pinned: input.pinned }),
		}),
		...(input.proxyRequestImpl
			? { proxyRequestImpl: input.proxyRequestImpl }
			: {}),
		requestHeaders: input.requestHeaders,
		routeFamily: "/o/:orgSlug/new-space",
		schema: listProfileSpaceHistoryResponseSchema,
		webAppUrl: input.webAppUrl,
		openMeldProfileId: profileId,
	});

	return payload.items;
}

export async function fetchProfileSpaceHistoryFromRequest(input: {
	gatewayUrl: string;
	webAppUrl: string;
	profileId: string;
	limit?: number;
	pinned?: boolean;
	fetchImpl?: typeof fetch;
}): Promise<readonly ProfileSpaceHistoryRecord[]> {
	return await readProfileSpaceHistory({
		gatewayUrl: input.gatewayUrl,
		webAppUrl: input.webAppUrl,
		requestHeaders: getRequestHeaders(),
		profileId: input.profileId,
		...(input.limit === undefined ? {} : { limit: input.limit }),
		...(input.pinned === undefined ? {} : { pinned: input.pinned }),
		fetchImpl: input.fetchImpl,
	});
}
