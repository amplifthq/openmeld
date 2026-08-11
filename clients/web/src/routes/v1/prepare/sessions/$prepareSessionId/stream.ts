import { createFileRoute } from "@tanstack/react-router";
import { getRequiredServerEnv } from "#/env";
import { proxyPrepareSessionStreamRequest } from "#/lib/connect/prepare-session-stream.server";

export const Route = createFileRoute(
	"/v1/prepare/sessions/$prepareSessionId/stream"
)({
	server: {
		handlers: {
			GET: ({ request }) =>
				proxyPrepareSessionStreamRequest({
					request,
					gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
					webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
				}),
		},
	},
});
