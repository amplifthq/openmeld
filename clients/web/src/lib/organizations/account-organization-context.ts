import { readAccountOrganizationContext } from "@openmeld/api-client";
import { createIsomorphicFn } from "@tanstack/react-start";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export const readCurrentAccountOrganizationContext = createIsomorphicFn()
	.client((_routeFamily: string, signal?: AbortSignal) =>
		readAccountOrganizationContext(createUnscopedWebOpenMeldApiFoundation(), {
			signal,
			timeoutMs: 5000,
		})
	)
	.server(async (routeFamily: string, signal?: AbortSignal) => {
		const { readAccountOrganizationContextFromRequest } = await import(
			"./account-organization-context.server"
		);
		return readAccountOrganizationContextFromRequest(routeFamily, {
			signal,
			timeoutMs: 5000,
		});
	});
