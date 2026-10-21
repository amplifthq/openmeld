import {
	createProfilesApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	AgentProfileBindingTarget,
	GetAgentProfileFoldersResponse,
	ManageAgentProfileFoldersResponse,
	ProfileFolderOperation,
} from "@openmeld/schemas/types";
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

/** Owner-only folder change, applied by the Agent's bound Computer. */
export async function manageAgentProfileFolders(input: {
	actorProfileId?: string | null;
	expectedBindingTarget: AgentProfileBindingTarget;
	operation: Exclude<ProfileFolderOperation, { operation: "list" }>;
	organizationId: string;
	profileId: string;
}): Promise<ManageAgentProfileFoldersResponse> {
	try {
		return await createProfilesApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
			})
		).manageFolders({
			expectedBindingTarget: input.expectedBindingTarget,
			operation: input.operation,
			profileId: input.profileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
