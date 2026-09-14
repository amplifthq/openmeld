import {
	createAgentProfileBodySchema,
	createdAgentProfileActionResponseSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/profiles/agents")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/v1/profiles/agents",
					responseSchema: createdAgentProfileActionResponseSchema,
					bodySchema: createAgentProfileBodySchema,
				}),
		},
	},
});
