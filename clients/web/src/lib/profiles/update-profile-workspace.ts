import {
	createCurrentDeviceApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function updateAgentProfileWorkspace(input: {
	actorProfileId?: string | null;
	profileId: string;
	workspaceMode: "custom" | "openmeld_managed";
	workspacePath?: string;
}): Promise<void> {
	try {
		await createCurrentDeviceApi(
			createWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
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
