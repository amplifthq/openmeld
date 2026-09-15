import {
	organizationActionSuccessSchema,
	organizationIdActionSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/organizations/delete")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/delete",
					responseSchema: organizationActionSuccessSchema,
					bodySchema: organizationIdActionSchema,
					project: () => ({ ok: true }),
				}),
		},
	},
});
