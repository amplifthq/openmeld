import { OPENMELD_HEADER_PROFILE_ID } from "@openmeld/gateway-contract";
import type { ZodType } from "zod/v4";
import { getRequiredServerEnv } from "#/env";
import {
	type CurrentUserSessionExpectation,
	createDevSsrFetchFailure,
} from "#/lib/dev-ssr-fetch-diagnostics";
import { copyOpenMeldClientAddressHeader } from "./gateway-upstream";
import { proxyOpenMeldGatewayRequest } from "./proxy";

const OPENMELD_PUBLIC_ROUTE_PREFIX = "/v1/";

export async function readJsonFromWebOpenMeldBoundary<T>(input: {
	path: string;
	requestHeaders: Headers;
	webAppUrl: string;
	openMeldProfileId?: string;
	gatewayUrl?: string;
	currentUserSessionExpectation?: CurrentUserSessionExpectation;
	operation: string;
	routeFamily?: string;
	schema: ZodType<T>;
	invalidMessage: string;
	fetchImpl?: typeof fetch;
	proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
}): Promise<T> {
	if (
		input.path !== "/v1" &&
		!input.path.startsWith(OPENMELD_PUBLIC_ROUTE_PREFIX)
	) {
		throw new Error(
			`Web OpenMeld boundary only supports /v1/* routes: ${input.path}`
		);
	}

	const routeFamily = input.routeFamily ?? "unknown_route";
	const currentUserSessionExpectation =
		input.currentUserSessionExpectation ?? "optional";
	const targetUrl = new URL(input.path, input.webAppUrl);
	const hasCookie = input.requestHeaders.get("cookie") !== null;
	let response: Response;
	try {
		response = await (input.proxyRequestImpl ?? proxyOpenMeldGatewayRequest)({
			request: createWebOpenMeldBoundaryRequest({
				path: input.path,
				requestHeaders: input.requestHeaders,
				webAppUrl: input.webAppUrl,
				openMeldProfileId: input.openMeldProfileId,
			}),
			gatewayUrl:
				input.gatewayUrl ?? getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
			webAppUrl: input.webAppUrl,
			fetchImpl: input.fetchImpl,
		});
	} catch (error) {
		throw createDevSsrFetchFailure({
			kind: "openmeld_boundary_runtime_fetch_failed",
			operation: input.operation,
			targetUrl,
			routeFamily,
			hasCookie,
			currentUserSessionExpectation,
			message: `OpenMeld couldn't ${input.operation} before receiving an HTTP response.`,
			cause: error,
		});
	}
	if (!response.ok) {
		throw createDevSsrFetchFailure({
			kind: "upstream_http_failure",
			operation: input.operation,
			targetUrl,
			routeFamily,
			hasCookie,
			currentUserSessionExpectation,
			message: `Failed to ${input.operation}: ${response.status}`,
			status: response.status,
		});
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw createDevSsrFetchFailure({
			kind: "invalid_response_failure",
			operation: input.operation,
			targetUrl,
			routeFamily,
			hasCookie,
			currentUserSessionExpectation,
			message: `${input.invalidMessage}: failed to parse JSON.`,
			status: response.status,
			cause: error,
		});
	}
	const parsed = input.schema.safeParse(payload);
	if (!parsed.success) {
		throw createDevSsrFetchFailure({
			kind: "invalid_response_failure",
			operation: input.operation,
			targetUrl,
			routeFamily,
			hasCookie,
			currentUserSessionExpectation,
			message: `${input.invalidMessage}: ${parsed.error.message}`,
			status: response.status,
			cause: parsed.error,
		});
	}

	return parsed.data;
}

function createWebOpenMeldBoundaryRequest(input: {
	path: string;
	requestHeaders: Headers;
	webAppUrl: string;
	openMeldProfileId?: string;
}): Request {
	const headers = new Headers({
		accept: "application/json",
	});
	const cookie = input.requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}
	// Keep the edge identity until the shared Gateway proxy constructs the
	// same-zone forwarding header. Do not copy caller-supplied proxy headers.
	const clientIp = input.requestHeaders.get("cf-connecting-ip");
	if (clientIp) {
		headers.set("cf-connecting-ip", clientIp);
	}
	if (input.openMeldProfileId) {
		headers.set(OPENMELD_HEADER_PROFILE_ID, input.openMeldProfileId);
	}
	// The proxy forwards this only across the Gateway Service Binding.
	copyOpenMeldClientAddressHeader({ from: input.requestHeaders, to: headers });

	return new Request(new URL(input.path, input.webAppUrl), {
		method: "GET",
		headers,
	});
}
