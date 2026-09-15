import { clientEnvironmentResponseSchema } from "@openmeld/schemas";
import { createUnscopedWebOpenMeldApiFoundation } from "./client";

// This is current endpoint metadata, never identity or authorization. In
// Desktop the fixed native transport selects the Web endpoint, not the build.
export async function getWebGatewayHost(): Promise<string> {
	const environment =
		await createUnscopedWebOpenMeldApiFoundation().requestJson({
			url: "/v1/client-environment",
			method: "GET",
			operation: "client.environment.read",
			schema: clientEnvironmentResponseSchema,
			invalidMessage: "Invalid client environment response.",
		});
	return environment.gatewayHost;
}
