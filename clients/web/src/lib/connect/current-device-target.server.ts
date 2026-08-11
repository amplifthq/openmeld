import { currentDeviceTargetResponseSchema } from "@openmeld/schemas";
import type { CurrentDeviceTargetResponse } from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { proxyOpenMeldGatewayRequest } from "#/lib/openmeld-api/proxy";
import { readJsonFromWebOpenMeldBoundary } from "#/lib/openmeld-api/server-read";

export async function readCurrentDeviceTarget(input: {
	requestHeaders: Headers;
	webAppUrl: string;
	gatewayUrl?: string;
	fetchImpl?: typeof fetch;
	proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
}): Promise<CurrentDeviceTargetResponse> {
	return await readJsonFromWebOpenMeldBoundary({
		currentUserSessionExpectation: "required",
		path: "/v1/devices/current",
		requestHeaders: input.requestHeaders,
		webAppUrl: input.webAppUrl,
		gatewayUrl: input.gatewayUrl,
		operation: "resolve current device target",
		routeFamily: "/o/:orgSlug/connect",
		schema: currentDeviceTargetResponseSchema,
		invalidMessage: "Invalid current device target response",
		fetchImpl: input.fetchImpl,
		proxyRequestImpl: input.proxyRequestImpl,
	});
}

export async function fetchCurrentDeviceTargetFromRequest(input: {
	webAppUrl: string;
	gatewayUrl?: string;
	fetchImpl?: typeof fetch;
	proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
}): Promise<CurrentDeviceTargetResponse> {
	return await readCurrentDeviceTarget({
		requestHeaders: getRequestHeaders(),
		webAppUrl: input.webAppUrl,
		gatewayUrl: input.gatewayUrl,
		fetchImpl: input.fetchImpl,
		proxyRequestImpl: input.proxyRequestImpl,
	});
}
