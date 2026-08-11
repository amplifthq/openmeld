import {
	buildAccountSpaceActiveWakeSummaryPath,
	resolveAccountSpaceIndexGatewayHost,
} from "@openmeld/api-client";
import { accountSpaceActiveWakeSummaryResponseSchema } from "@openmeld/schemas";
import type { AccountSpaceActiveWakeSummaryResponse } from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { proxyOpenMeldGatewayRequest } from "#/lib/openmeld-api/proxy";
import { readJsonFromWebOpenMeldBoundary } from "#/lib/openmeld-api/server-read";

export async function readAccountSpaceActiveWakeSummary(input: {
	gatewayUrl: string;
	webAppUrl: string;
	requestHeaders: Headers;
	profileId: string;
	proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
}): Promise<AccountSpaceActiveWakeSummaryResponse> {
	const profileId = input.profileId.trim();
	if (profileId.length === 0) {
		throw new Error("Account space active wake summary requires a profile ID.");
	}

	return await readJsonFromWebOpenMeldBoundary({
		currentUserSessionExpectation: "required",
		gatewayUrl: input.gatewayUrl,
		invalidMessage: "Invalid account space active wake summary response",
		operation: "list account space active wakes",
		path: buildAccountSpaceActiveWakeSummaryPath({
			gatewayHost: resolveAccountSpaceIndexGatewayHost(input.gatewayUrl),
			selectedProfileId: profileId,
		}),
		...(input.proxyRequestImpl
			? { proxyRequestImpl: input.proxyRequestImpl }
			: {}),
		requestHeaders: input.requestHeaders,
		routeFamily: "/o/:orgSlug/spaces",
		schema: accountSpaceActiveWakeSummaryResponseSchema,
		webAppUrl: input.webAppUrl,
		openMeldProfileId: profileId,
	});
}

export async function fetchAccountSpaceActiveWakeSummaryFromRequest(input: {
	gatewayUrl: string;
	webAppUrl: string;
	profileId: string;
}): Promise<AccountSpaceActiveWakeSummaryResponse> {
	return await readAccountSpaceActiveWakeSummary({
		gatewayUrl: input.gatewayUrl,
		webAppUrl: input.webAppUrl,
		requestHeaders: getRequestHeaders(),
		profileId: input.profileId,
	});
}
