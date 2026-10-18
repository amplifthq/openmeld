import { listMemberAgentsResponseSchema } from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/member-agents")({
	server: {
		handlers: {
			GET: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/v1/member-agents",
					responseSchema: listMemberAgentsResponseSchema,
				}),
		},
	},
});
