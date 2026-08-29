import {
	createCurrentDeviceApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function updateAgentProfileWorkspace(input: {
	actorProfileId?: string | null;
	organizationId: string;
	profileId: string;
	workspaceMode: "custom" | "openmeld_managed";
	workspacePath?: string;
}): Promise<void> {
	try {
		await createCurrentDeviceApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
				organizationId: input.organizationId,
			})
		).setCurrentAgentProfileWorkspace({
			agentProfileId: input.profileId,
			workspaceMode: input.workspaceMode,
			...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
