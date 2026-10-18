import {
	createProfilesApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { GetAgentProfileFoldersResponse } from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

/** Owner-only: the Agent's folders on its Computer, by id and name only. */
export async function readAgentProfileFolders(input: {
	organizationId: string;
	profileId: string;
}): Promise<GetAgentProfileFoldersResponse> {
	try {
		return await createProfilesApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).getFolders({ profileId: input.profileId });
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
