import { createFileRoute } from "@tanstack/react-router";
import { getRequiredServerEnv } from "#/env";
import { proxySimpleWebSocketRequest } from "#/lib/openmeld-api/simple-websocket-proxy.server";

const ACCOUNT_INVALIDATION_STREAM_PATH =
	/^\/v1\/account\/invalidation-stream$/u;

export const Route = createFileRoute("/v1/account/invalidation-stream")({
	server: {
		handlers: {
			GET: ({ request }) =>
				proxySimpleWebSocketRequest({
					request,
					gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
					webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
					pathPattern: ACCOUNT_INVALIDATION_STREAM_PATH,
				}),
		},
	},
});
