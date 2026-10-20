import {
	buildMemberAgentProfilesRoute,
	resolveMemberAgentProfilesResponseSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute(
	"/v1/member-agents/$memberAgentId/profiles"
)({
	server: {
		handlers: {
			GET: ({ request, params }) =>
				authBusinessRequest({
					request,
					upstreamPath: buildMemberAgentProfilesRoute(params.memberAgentId),
					responseSchema: resolveMemberAgentProfilesResponseSchema,
				}),
		},
	},
});
