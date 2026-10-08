import { isHostedAgentControllerRef } from "@openmeld/schemas";

export function formatSpaceAgentAttribution(input: {
	agentControllerRef: string | null;
	centerAgentModelName?: string | null;
	ownerName: string | null;
	profileKind: string;
}): string | null {
	if (input.profileKind !== "agent") {
		return null;
	}

	if (input.centerAgentModelName !== undefined) {
		return input.centerAgentModelName;
	}

	if (isHostedAgentControllerRef(input.agentControllerRef)) {
		return "Hosted by OpenMeld";
	}
	return input.ownerName?.trim() || null;
}
