import { readAccountOrganizationContext } from "@openmeld/api-client";
import { createIsomorphicFn } from "@tanstack/react-start";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export const readCurrentAccountOrganizationContext = createIsomorphicFn()
	.client((_routeFamily: string) =>
		readAccountOrganizationContext(createUnscopedWebOpenMeldApiFoundation())
	)
	.server(async (routeFamily: string) => {
		const { readAccountOrganizationContextFromRequest } = await import(
			"./account-organization-context.server"
		);
		return readAccountOrganizationContextFromRequest(routeFamily);
	});
