import { createFileRoute } from "@tanstack/react-router";
import { proxyAuthOwnedRequest } from "#/lib/auth-proxy.server";

export const Route = createFileRoute("/v1/profiles")({
	server: {
		handlers: {
			GET: ({ request }) =>
				proxyAuthOwnedRequest({ request, upstreamPath: "/v1/profiles" }),
		},
	},
});
