import {
	createdHumanProfileActionResponseSchema,
	createHumanProfileBodySchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/profiles/humans")({
	server: {
		handlers: {
			POST: ({ request }) =>
				authBusinessRequest({
					request,
					upstreamPath: "/v1/profiles/humans",
					responseSchema: createdHumanProfileActionResponseSchema,
					bodySchema: createHumanProfileBodySchema,
				}),
		},
	},
});
