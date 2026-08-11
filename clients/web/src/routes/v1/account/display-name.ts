import { createFileRoute } from "@tanstack/react-router";
import { proxyAuthOwnedRequest } from "#/lib/auth-proxy.server";

const ACCOUNT_DISPLAY_NAME_PATH = "/v1/account/display-name";

function proxyAccountDisplayNameRequest(request: Request): Promise<Response> {
	return proxyAuthOwnedRequest({
		request,
		upstreamPath: ACCOUNT_DISPLAY_NAME_PATH,
	});
}

export const Route = createFileRoute("/v1/account/display-name")({
	server: {
		handlers: {
			PATCH: ({ request }) => proxyAccountDisplayNameRequest(request),
		},
	},
});
