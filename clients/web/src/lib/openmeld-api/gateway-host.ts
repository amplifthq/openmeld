import { clientEnvironmentResponseSchema } from "@openmeld/schemas";
import { resolveAppQueryClient } from "#/integrations/tanstack-query/query-client";
import {
	createUnscopedWebOpenMeldApiFoundation,
	resolveWebOpenMeldApiBaseUrl,
} from "./client";

// This is current endpoint metadata, never identity or authorization. In
// Desktop the fixed native transport selects the Web endpoint, not the build.
export async function getWebGatewayHost(): Promise<string> {
	const baseUrl = resolveWebOpenMeldApiBaseUrl();
	const environment = await resolveAppQueryClient().fetchQuery({
		queryKey: ["client-environment", baseUrl],
		staleTime: 5 * 60_000,
		queryFn: () =>
			createUnscopedWebOpenMeldApiFoundation({ baseUrl }).requestJson({
				url: "/v1/client-environment",
				method: "GET",
				operation: "client.environment.read",
				schema: clientEnvironmentResponseSchema,
				invalidMessage: "Invalid client environment response.",
			}),
	});
	return environment.gatewayHost;
}
