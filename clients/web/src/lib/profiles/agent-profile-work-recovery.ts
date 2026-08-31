import {
	createAgentProfileWorkRecoveryApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	ExecuteAgentProfileWorkRecoveryBody,
	ExecuteAgentProfileWorkRecoveryResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function executeAgentProfileWorkRecovery(
	input: {
		agentProfileId: string;
		organizationId: string;
	} & ExecuteAgentProfileWorkRecoveryBody
): Promise<ExecuteAgentProfileWorkRecoveryResponse> {
	try {
		return await createAgentProfileWorkRecoveryApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).execute({
			agentProfileId: input.agentProfileId,
			...(input.action === "skip_interrupted_work"
				? {
						action: input.action,
						expectedInterruptedTargetWakeLifecycleId:
							input.expectedInterruptedTargetWakeLifecycleId,
					}
				: { action: input.action }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
