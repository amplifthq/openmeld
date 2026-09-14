import {
	organizationActionSuccessSchema,
	organizationInvitationIdActionSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/organizations/cancel-invitation")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/cancel-invitation",
					responseSchema: organizationActionSuccessSchema,
					bodySchema: organizationInvitationIdActionSchema,
					project: () => ({ ok: true }),
				}),
		},
	},
});
