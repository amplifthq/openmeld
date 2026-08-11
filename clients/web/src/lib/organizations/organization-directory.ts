import {
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { ORGANIZATION_DIRECTORY_INCLUDE_HUMAN_PROFILE_LAST_USED_AT_QUERY_PARAMETER } from "@openmeld/gateway-contract";
import { organizationDirectoryResponseSchema } from "@openmeld/schemas";
import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function readCurrentOrganizationDirectory(input: {
	organizationId: string;
}): Promise<OrganizationDirectoryResponse> {
	const query = new URLSearchParams({
		[ORGANIZATION_DIRECTORY_INCLUDE_HUMAN_PROFILE_LAST_USED_AT_QUERY_PARAMETER]:
			"true",
	});
	try {
		return await createWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		}).requestJson({
			invalidMessage: "Invalid organization directory response.",
			method: "GET",
			operation: "organization.directory.read",
			schema: organizationDirectoryResponseSchema,
			url: `/v1/organizations/current/directory?${query.toString()}`,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export type OrganizationDirectoryFailure = StructuredApiClientFailure;
