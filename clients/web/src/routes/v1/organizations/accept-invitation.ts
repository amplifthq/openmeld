import {
	organizationInvitationAcceptedSchema,
	organizationInvitationIdActionSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";
import { normalizeAcceptedInvitation } from "#/lib/organizations/organization-projections.server";

export const Route = createFileRoute("/v1/organizations/accept-invitation")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/accept-invitation",
					responseSchema: organizationInvitationAcceptedSchema,
					bodySchema: organizationInvitationIdActionSchema,
					project: normalizeAcceptedInvitation,
				}),
		},
	},
});
