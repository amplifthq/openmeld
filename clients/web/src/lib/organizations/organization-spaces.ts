import {
	createOrganizationApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	OrganizationSpaceDirectoryWithMemberCountsResponse,
	PostSpaceMembersResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { createOrganizationScopedWebSpaceApi } from "#/lib/spaces/api";

export type OrganizationSpacesFailure = StructuredApiClientFailure;

export async function listCurrentOrganizationSpaces(input: {
	organizationId: string;
}): Promise<OrganizationSpaceDirectoryWithMemberCountsResponse> {
	try {
		return await createOrganizationApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).listCurrentSpacesWithMemberCounts();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function joinOrganizationSpace(input: {
	organizationId: string;
	spaceId: string;
}): Promise<PostSpaceMembersResponse> {
	try {
		return await createOrganizationScopedWebSpaceApi({
			organizationId: input.organizationId,
		}).joinSpace({ spaceId: input.spaceId });
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
