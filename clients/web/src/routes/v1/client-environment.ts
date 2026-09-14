import { resolveProfileSpaceHistoryGatewayHost } from "@openmeld/api-client";
import { clientEnvironmentResponseSchema } from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { getRequiredServerEnv } from "#/env";

export const Route = createFileRoute("/v1/client-environment")({
	server: {
		handlers: {
			GET: () =>
				Response.json(
					clientEnvironmentResponseSchema.parse({
						gatewayHost: resolveProfileSpaceHistoryGatewayHost(
							getRequiredServerEnv("OPENMELD_GATEWAY_URL")
						),
					}),
					{ headers: { "cache-control": "no-store" } }
				),
		},
	},
});
