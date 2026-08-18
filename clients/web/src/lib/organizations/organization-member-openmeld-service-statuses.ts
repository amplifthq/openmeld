import {
	createOrganizationApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { OrganizationMemberOpenMeldServiceStatusesResponse } from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type OrganizationMemberOpenMeldServiceStatusesFailure =
	StructuredApiClientFailure;

export async function readCurrentOrganizationMemberOpenMeldServiceStatuses(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<OrganizationMemberOpenMeldServiceStatusesResponse> {
	try {
		const response = await createOrganizationApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).getCurrentMemberOpenMeldServiceStatuses({ signal: input.signal });
		if (response.organizationId !== input.organizationId) {
			throw new Error(
				"Organization member OpenMeld Service status response organization mismatch."
			);
		}
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
