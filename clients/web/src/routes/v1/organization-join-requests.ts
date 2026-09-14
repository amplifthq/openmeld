import {
	organizationJoinRequestInputSchema,
	organizationJoinRequestResponseSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/organization-join-requests")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/join-requests",
					responseSchema: organizationJoinRequestResponseSchema,
					bodySchema: organizationJoinRequestInputSchema,
				}),
		},
	},
});
