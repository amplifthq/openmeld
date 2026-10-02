import { createFileRoute } from "@tanstack/react-router";
import { proxyAuthOwnedRequest } from "#/lib/auth-proxy.server";

export const Route = createFileRoute("/v1/profiles/agents/$profileId/avatar")({
	server: {
		handlers: {
			PATCH: ({ request, params }) =>
				proxyAuthOwnedRequest({
					request,
					upstreamPath: `/v1/profiles/agents/${encodeURIComponent(params.profileId)}/avatar`,
				}),
		},
	},
});
