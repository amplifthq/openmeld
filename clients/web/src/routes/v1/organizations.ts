import {
	organizationCreateActionSchema,
	organizationCreatedActionResponseSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";
import { normalizeCreatedOrganization } from "#/lib/organizations/organization-projections.server";

export const Route = createFileRoute("/v1/organizations")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/create",
					responseSchema: organizationCreatedActionResponseSchema,
					bodySchema: organizationCreateActionSchema,
					project: normalizeCreatedOrganization,
				}),
		},
	},
});
