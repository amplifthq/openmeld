import {
	buildAccountSpaceIndexPath,
	resolveAccountSpaceIndexGatewayHost,
} from "@openmeld/api-client";
import { accountSpaceIndexResponseSchema } from "@openmeld/schemas";
import type { AccountSpaceIndexResponse } from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { proxyOpenMeldGatewayRequest } from "#/lib/openmeld-api/proxy";
import { readJsonFromWebOpenMeldBoundary } from "#/lib/openmeld-api/server-read";

export async function readAccountSpaceIndex(input: {
	gatewayUrl: string;
	webAppUrl: string;
	requestHeaders: Headers;
	profileId: string;
	includeDirectMessageProfileIds?: boolean;
	includePurposes?: boolean;
	limit?: number;
	scope: "account" | "profile";
	fetchImpl?: typeof fetch;
	proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
}): Promise<AccountSpaceIndexResponse> {
	const profileId = input.profileId.trim();
	if (profileId.length === 0) {
		throw new Error("Account space index requires a profile ID.");
	}

	return await readJsonFromWebOpenMeldBoundary({
		currentUserSessionExpectation: "required",
		gatewayUrl: input.gatewayUrl,
		invalidMessage: "Invalid account spaces response",
		operation: "list account spaces",
		path: buildAccountSpaceIndexPath({
			gatewayHost: resolveAccountSpaceIndexGatewayHost(input.gatewayUrl),
			includeDirectMessageProfileIds:
				input.includeDirectMessageProfileIds === true,
			// The Web surfaces the one-time "this space was deleted" notice, so it
			// opts in to the recently-deleted payload (strict legacy clients do not).
			includeRecentlyDeletedItems: true,
			includeMemberPreviews: true,
			includeMessagePreviews: true,
			includePurposes: input.includePurposes === true,
			...(input.limit === undefined ? {} : { limit: input.limit }),
			scope: input.scope,
			selectedProfileId: profileId,
		}),
		...(input.proxyRequestImpl
			? { proxyRequestImpl: input.proxyRequestImpl }
			: {}),
		requestHeaders: input.requestHeaders,
		routeFamily: "/o/:orgSlug/spaces",
		schema: accountSpaceIndexResponseSchema,
		webAppUrl: input.webAppUrl,
		openMeldProfileId: profileId,
	});
}

export async function fetchAccountSpaceIndexFromRequest(input: {
	gatewayUrl: string;
	webAppUrl: string;
	profileId: string;
	includeDirectMessageProfileIds?: boolean;
	includePurposes?: boolean;
	limit?: number;
	scope: "account" | "profile";
	fetchImpl?: typeof fetch;
}): Promise<AccountSpaceIndexResponse> {
	return await readAccountSpaceIndex({
		gatewayUrl: input.gatewayUrl,
		webAppUrl: input.webAppUrl,
		requestHeaders: getRequestHeaders(),
		profileId: input.profileId,
		scope: input.scope,
		includeDirectMessageProfileIds: input.includeDirectMessageProfileIds,
		includePurposes: input.includePurposes,
		...(input.limit === undefined ? {} : { limit: input.limit }),
		fetchImpl: input.fetchImpl,
	});
}
