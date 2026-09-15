import {
	getOrganizationJoinLinkResponseSchema,
	organizationJoinLinkManagementQuerySchema,
	revokeOrganizationJoinLinkResponseSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

const readOrReset = (request: Request) =>
	authBusinessRequest({
		request,
		upstreamPath: "/api/auth/organization/join-link",
		querySchema: organizationJoinLinkManagementQuerySchema,
		responseSchema: getOrganizationJoinLinkResponseSchema,
	});
export const Route = createFileRoute("/v1/organization-join-link")({
	server: {
		handlers: {
			GET: ({ request }) => readOrReset(request),
			POST: ({ request }) => readOrReset(request),
			DELETE: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/join-link",
					querySchema: organizationJoinLinkManagementQuerySchema,
					responseSchema: revokeOrganizationJoinLinkResponseSchema,
				}),
		},
	},
});
