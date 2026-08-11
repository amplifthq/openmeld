import {
	createOrganizationApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	OrganizationSpaceDirectoryWithMemberCountsResponse,
	PostSpaceMembersResponse,
} from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { createWebSpaceApi } from "#/lib/spaces/api";

export type OrganizationSpacesFailure = StructuredApiClientFailure;

export async function listCurrentOrganizationSpaces(input: {
	organizationId: string;
}): Promise<OrganizationSpaceDirectoryWithMemberCountsResponse> {
	try {
		return await createOrganizationApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).listCurrentSpacesWithMemberCounts();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function joinOrganizationSpace(input: {
	spaceId: string;
}): Promise<PostSpaceMembersResponse> {
	try {
		return await createWebSpaceApi().joinSpace({ spaceId: input.spaceId });
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
