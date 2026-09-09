import { isHostedAgentControllerRef } from "@openmeld/schemas";

export function formatSpaceAgentAttribution(input: {
	agentControllerRef: string | null;
	ownerName: string | null;
	profileKind: string;
}): string | null {
	if (input.profileKind !== "agent") {
		return null;
	}

	if (isHostedAgentControllerRef(input.agentControllerRef)) {
		return "Hosted by OpenMeld";
	}
	return input.ownerName?.trim() || null;
}
