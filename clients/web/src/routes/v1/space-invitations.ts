import {
	spaceInvitationRequestSchema,
	spaceInvitationResponseSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/space-invitations")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/api/auth/space-invitations",
					responseSchema: spaceInvitationResponseSchema,
					bodySchema: spaceInvitationRequestSchema,
				}),
		},
	},
});
