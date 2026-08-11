import { createFileRoute } from "@tanstack/react-router";
import { getRequiredServerEnv } from "#/env";
import { proxySpaceLiveStreamRequest } from "#/lib/spaces/live-stream.server";

export const Route = createFileRoute("/v1/spaces/$spaceId/stream")({
	server: {
		handlers: {
			GET: ({ request }) =>
				proxySpaceLiveStreamRequest({
					request,
					gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
					webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
					authBaseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
					spaceAccessCookieSecret: getRequiredServerEnv(
						"WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET"
					),
				}),
		},
	},
});
