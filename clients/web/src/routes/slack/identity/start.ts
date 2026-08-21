import { createFileRoute } from "@tanstack/react-router";
import { getRequiredServerEnv } from "#/env";
import { proxyOpenMeldGatewayRequest } from "#/lib/openmeld-api/proxy";

async function startSlackIdentityAuthorization(
	request: Request
): Promise<Response> {
	const { readWebProxyCloudflareRuntimeEvidence } = await import(
		"#/lib/openmeld-api/proxy-cloudflare-runtime.server"
	);
	return await proxyOpenMeldGatewayRequest({
		cloudflareRuntimeEvidence: readWebProxyCloudflareRuntimeEvidence(),
		gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
		request,
		spaceAccessCookieSecret: getRequiredServerEnv(
			"WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET"
		),
		webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
	});
}

export const Route = createFileRoute("/slack/identity/start")({
	server: {
		handlers: {
			GET: ({ request }) => startSlackIdentityAuthorization(request),
		},
	},
});
