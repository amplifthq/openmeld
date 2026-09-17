import {
	organizationIdActionSchema,
	organizationInvitationsResponseSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";
import { normalizeOrganizationInvitations } from "#/lib/organizations/organization-projections.server";

export const Route = createFileRoute("/v1/organizations/list-invitations")({
	server: {
		handlers: {
			GET: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/list-invitations",
					responseSchema: organizationInvitationsResponseSchema,
					querySchema: organizationIdActionSchema,
					project: normalizeOrganizationInvitations,
				}),
		},
	},
});
