import { userOrganizationInvitationsResponseSchema } from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";
import { normalizeUserOrganizationInvitations } from "#/lib/organizations/organization-projections.server";

export const Route = createFileRoute("/v1/organizations/list-user-invitations")(
	{
		server: {
			handlers: {
				GET: ({ request }) =>
					authBusinessRequest({
						request,
						upstreamPath: "/api/auth/organization/list-user-invitations",
						responseSchema: userOrganizationInvitationsResponseSchema,
						project: normalizeUserOrganizationInvitations,
					}),
			},
		},
	}
);
