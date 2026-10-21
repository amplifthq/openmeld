import { createCenterAgentApi } from "@openmeld/api-client";
import type {
	GetCenterAgentDirectMessageSpaceProjectionResponse,
	OpenCenterAgentDirectMessageSpaceResponse,
} from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getRequiredServerEnv } from "#/env";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { copyOpenMeldClientAddressHeader } from "#/lib/openmeld-api/gateway-upstream";
import { proxyOpenMeldGatewayRequest } from "#/lib/openmeld-api/proxy";

type CenterAgentDirectMessageWebBoundaryInput = {
	gatewayUrl?: string;
	organizationId: string;
	requestHeaders: Headers;
	webAppUrl: string;
	fetchImpl?: typeof fetch;
	proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
	signal?: AbortSignal;
};

function createCenterAgentDirectMessageApiAtWebBoundary(
	input: CenterAgentDirectMessageWebBoundaryInput
) {
	const proxyRequestImpl =
		input.proxyRequestImpl ?? proxyOpenMeldGatewayRequest;
	const gatewayUrl =
		input.gatewayUrl ?? getRequiredServerEnv("OPENMELD_GATEWAY_URL");
	const proxyFetch: typeof fetch = async (resource, init) => {
		const headers = new Headers(init?.headers);
		const cookie = input.requestHeaders.get("cookie");
		if (cookie) {
			headers.set("cookie", cookie);
		}
		copyOpenMeldClientAddressHeader({
			from: input.requestHeaders,
			to: headers,
		});

		return await proxyRequestImpl({
			fetchImpl: input.fetchImpl,
			gatewayUrl,
			request: new Request(resource, {
				...init,
				headers,
			}),
			webAppUrl: input.webAppUrl,
		});
	};
	return createCenterAgentApi(
		createOrganizationScopedWebOpenMeldApiFoundation({
			baseUrl: input.webAppUrl,
			fetchImpl: proxyFetch,
			organizationId: input.organizationId,
		})
	);
}

export async function openCenterAgentDirectMessageSpaceAtWebBoundary(
	input: CenterAgentDirectMessageWebBoundaryInput
): Promise<OpenCenterAgentDirectMessageSpaceResponse> {
	return await createCenterAgentDirectMessageApiAtWebBoundary(
		input
	).openDirectMessageSpace({ signal: input.signal });
}

export async function readCenterAgentDirectMessageSpaceProjectionAtWebBoundary(
	input: CenterAgentDirectMessageWebBoundaryInput & { spaceId?: string }
): Promise<GetCenterAgentDirectMessageSpaceProjectionResponse> {
	const api = createCenterAgentDirectMessageApiAtWebBoundary(input);
	return input.spaceId === undefined
		? await api.getDirectMessageSpaceProjection({ signal: input.signal })
		: await api.getSession({ spaceId: input.spaceId, signal: input.signal });
}

export async function openCenterAgentDirectMessageSpaceFromRequest(input: {
	webAppUrl: string;
	gatewayUrl?: string;
	organizationId: string;
	fetchImpl?: typeof fetch;
	proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
	signal?: AbortSignal;
}): Promise<OpenCenterAgentDirectMessageSpaceResponse> {
	return await openCenterAgentDirectMessageSpaceAtWebBoundary({
		...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
		...(input.gatewayUrl === undefined ? {} : { gatewayUrl: input.gatewayUrl }),
		organizationId: input.organizationId,
		...(input.proxyRequestImpl === undefined
			? {}
			: { proxyRequestImpl: input.proxyRequestImpl }),
		requestHeaders: getRequestHeaders(),
		...(input.signal === undefined ? {} : { signal: input.signal }),
		webAppUrl: input.webAppUrl,
	});
}

export async function readCenterAgentDirectMessageSpaceProjectionFromRequest(input: {
	spaceId?: string;
	webAppUrl: string;
	gatewayUrl?: string;
	organizationId: string;
	fetchImpl?: typeof fetch;
	proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
	signal?: AbortSignal;
}): Promise<GetCenterAgentDirectMessageSpaceProjectionResponse> {
	return await readCenterAgentDirectMessageSpaceProjectionAtWebBoundary({
		...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
		...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
		...(input.gatewayUrl === undefined ? {} : { gatewayUrl: input.gatewayUrl }),
		organizationId: input.organizationId,
		...(input.proxyRequestImpl === undefined
			? {}
			: { proxyRequestImpl: input.proxyRequestImpl }),
		requestHeaders: getRequestHeaders(),
		...(input.signal === undefined ? {} : { signal: input.signal }),
		webAppUrl: input.webAppUrl,
	});
}
