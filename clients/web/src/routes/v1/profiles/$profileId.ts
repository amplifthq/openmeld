import { createFileRoute } from "@tanstack/react-router";
import { proxyAuthOwnedRequest } from "#/lib/auth-proxy.server";

function proxyProfileRequest(request: Request): Promise<Response> {
	return proxyAuthOwnedRequest({
		request,
		upstreamPath: new URL(request.url).pathname,
	});
}

export const Route = createFileRoute("/v1/profiles/$profileId")({
	server: {
		handlers: {
			PATCH: ({ request }) => proxyProfileRequest(request),
		},
	},
});
