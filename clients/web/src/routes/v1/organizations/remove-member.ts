import {
	organizationActionSuccessSchema,
	organizationMemberRemovalActionSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/organizations/remove-member")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/remove-member",
					responseSchema: organizationActionSuccessSchema,
					bodySchema: organizationMemberRemovalActionSchema,
					project: () => ({ ok: true }),
				}),
		},
	},
});
