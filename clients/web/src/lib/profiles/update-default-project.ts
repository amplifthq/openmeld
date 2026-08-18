import {
	createProfilesApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function updateAgentProfileDefaultProject(input: {
	actorProfileId?: string | null;
	defaultProjectId: string | null;
	organizationId: string;
	profileId: string;
}): Promise<AuthProfileView> {
	try {
		const response = await createProfilesApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
			})
		).updateDefaultProject({
			defaultProjectId: input.defaultProjectId,
			expectedOrganizationId: input.organizationId,
			profileId: input.profileId,
		});
		return response.profile;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
