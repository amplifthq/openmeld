import {
	organizationActionSuccessSchema,
	organizationUpdateActionSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/organizations/update")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/organization/update",
					responseSchema: organizationActionSuccessSchema,
					bodySchema: organizationUpdateActionSchema,
					project: () => ({ ok: true }),
				}),
		},
	},
});
