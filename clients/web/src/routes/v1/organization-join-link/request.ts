import {
	acceptOrganizationJoinLinkBodySchema,
	organizationJoinRequestResponseSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/organization-join-link/request")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/join-link/request",
					responseSchema: organizationJoinRequestResponseSchema,
					bodySchema: acceptOrganizationJoinLinkBodySchema,
				}),
		},
	},
});
