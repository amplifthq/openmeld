import {
	organizationActionSuccessSchema,
	organizationInviteActionSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/organizations/invite-member")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/invite-member",
					responseSchema: organizationActionSuccessSchema,
					bodySchema: organizationInviteActionSchema,
					project: () => ({ ok: true }),
				}),
		},
	},
});
