import { proxySimpleWebSocketRequest } from "#/lib/openmeld-api/simple-websocket-proxy.server";

const PREPARE_SESSION_STREAM_ROUTE_PATTERN =
	/^\/v1\/prepare\/sessions\/([^/]+)\/stream$/u;

export function proxyPrepareSessionStreamRequest(input: {
	request: Request;
	gatewayUrl: string;
	webAppUrl: string;
	fetchImpl?: typeof fetch;
}): Promise<Response> {
	return proxySimpleWebSocketRequest({
		...input,
		pathPattern: PREPARE_SESSION_STREAM_ROUTE_PATTERN,
	});
}
