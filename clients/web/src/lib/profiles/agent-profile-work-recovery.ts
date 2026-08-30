import {
	createAgentProfileWorkRecoveryApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	AgentProfileWorkRecoveryAction,
	ExecuteAgentProfileWorkRecoveryResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function executeAgentProfileWorkRecovery(input: {
	action: AgentProfileWorkRecoveryAction;
	agentProfileId: string;
	organizationId: string;
}): Promise<ExecuteAgentProfileWorkRecoveryResponse> {
	try {
		return await createAgentProfileWorkRecoveryApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).execute({
			action: input.action,
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
