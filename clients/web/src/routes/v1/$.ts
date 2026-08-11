import { createFileRoute } from "@tanstack/react-router";
import { getRequiredServerEnv } from "#/env";
import { proxyOpenMeldGatewayRequest } from "#/lib/openmeld-api/proxy";

async function proxyRequest(request: Request): Promise<Response> {
	const { readWebProxyCloudflareRuntimeEvidence } = await import(
		"#/lib/openmeld-api/proxy-cloudflare-runtime.server"
	);
	return await proxyOpenMeldGatewayRequest({
		request,
		gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
		webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
		spaceAccessCookieSecret: getRequiredServerEnv(
			"WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET"
		),
		cloudflareRuntimeEvidence: readWebProxyCloudflareRuntimeEvidence(),
	});
}

export const Route = createFileRoute("/v1/$")({
	server: {
		handlers: {
			DELETE: ({ request }) => proxyRequest(request),
			GET: ({ request }) => proxyRequest(request),
			HEAD: ({ request }) => proxyRequest(request),
			OPTIONS: ({ request }) => proxyRequest(request),
			PATCH: ({ request }) => proxyRequest(request),
			POST: ({ request }) => proxyRequest(request),
			PUT: ({ request }) => proxyRequest(request),
		},
	},
});
