import {
	createProfilesApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	AgentProfileBindingTarget,
	AuthProfileView,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function updateAgentProfileDefaultProject(input: {
	actorProfileId?: string | null;
	defaultProjectId: string | null;
	organizationId: string;
	profileId: string;
	expectedBindingTarget?: AgentProfileBindingTarget;
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
			...(input.expectedBindingTarget
				? { expectedBindingTarget: input.expectedBindingTarget }
				: {}),
			defaultProjectId: input.defaultProjectId,
			expectedOrganizationId: input.organizationId,
			profileId: input.profileId,
		});
		return response.profile;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
