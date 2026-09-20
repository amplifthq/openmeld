import { ACCOUNT_ORGANIZATION_CONTEXT_PATH } from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { proxyAuthOwnedRequest } from "#/lib/auth-proxy.server";

export const Route = createFileRoute("/v1/account/organization-context")({
	server: {
		handlers: {
			GET: ({ request }) =>
				proxyAuthOwnedRequest({
					request,
					preserveUnauthorizedStatus: true,
					upstreamPath: ACCOUNT_ORGANIZATION_CONTEXT_PATH,
				}),
		},
	},
});
