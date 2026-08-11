import { createFileRoute } from "@tanstack/react-router";
import {
	proxyAuthOwnedRequest,
	resolveBetterAuthUpstreamPath,
} from "#/lib/auth-proxy.server";

function proxyBetterAuthRequest(request: Request): Promise<Response> {
	return proxyAuthOwnedRequest({
		request,
		upstreamPath: resolveBetterAuthUpstreamPath(request.url),
	});
}

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			DELETE: ({ request }) => proxyBetterAuthRequest(request),
			GET: ({ request }) => proxyBetterAuthRequest(request),
			HEAD: ({ request }) => proxyBetterAuthRequest(request),
			OPTIONS: ({ request }) => proxyBetterAuthRequest(request),
			PATCH: ({ request }) => proxyBetterAuthRequest(request),
			POST: ({ request }) => proxyBetterAuthRequest(request),
			PUT: ({ request }) => proxyBetterAuthRequest(request),
		},
	},
});
