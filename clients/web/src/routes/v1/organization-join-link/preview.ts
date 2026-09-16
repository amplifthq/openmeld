import {
	previewOrganizationJoinLinkQuerySchema,
	previewOrganizationJoinLinkResponseSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/organization-join-link/preview")({
	server: {
		handlers: {
			GET: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/join-link/preview",
					responseSchema: previewOrganizationJoinLinkResponseSchema,
					querySchema: previewOrganizationJoinLinkQuerySchema,
				}),
		},
	},
});
