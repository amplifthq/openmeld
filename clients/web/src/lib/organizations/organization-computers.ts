import {
	createOrganizationApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { OrganizationComputersResponse } from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type OrganizationComputersFailure = StructuredApiClientFailure;

export async function readCurrentOrganizationComputers(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<OrganizationComputersResponse> {
	try {
		const response = await createOrganizationApi(
			createWebOpenMeldApiFoundation({ organizationId: input.organizationId })
		).getCurrentComputers({ signal: input.signal });
		if (response.organizationId !== input.organizationId) {
			throw new Error("Organization computers response organization mismatch.");
		}
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
