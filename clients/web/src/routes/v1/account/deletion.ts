import { createFileRoute } from "@tanstack/react-router";
import { proxyAuthOwnedRequest } from "#/lib/auth-proxy.server";

const proxy = (request: Request) =>
	proxyAuthOwnedRequest({ request, upstreamPath: "/v1/account/deletion" });
export const Route = createFileRoute("/v1/account/deletion")({
	server: {
		handlers: {
			GET: ({ request }) => proxy(request),
			POST: ({ request }) => proxy(request),
		},
	},
});
