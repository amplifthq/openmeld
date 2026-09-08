import { createFileRoute } from "@tanstack/react-router";
import { proxyAuthOwnedRequest } from "#/lib/auth-proxy.server";

function proxySidebarRequest(request: Request) {
	return proxyAuthOwnedRequest({
		request,
		upstreamPath: "/v1/account/sidebar",
	});
}

export const Route = createFileRoute("/v1/account/sidebar")({
	server: {
		handlers: {
			GET: ({ request }) => proxySidebarRequest(request),
			PUT: ({ request }) => proxySidebarRequest(request),
		},
	},
});
