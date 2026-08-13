import { isHostedCenterAgentControllerRef } from "@openmeld/schemas";

const OPENMELD_REMOTE_AGENT_CONTROLLER_DISPLAY = "Remote Agent";
const OPENMELD_REMOTE_AGENT_CONTROL_LABEL = "Hosted by OpenMeld";

export function formatSpaceAgentControlLabel(input: {
	agentControllerRef: string | null;
	controllerDisplay: string | null;
	profileKind: string;
	runtimeDeviceDisplayName: string | null;
}): string | null {
	if (input.profileKind !== "agent") {
		return null;
	}

	if (isHostedCenterAgentControllerRef(input.agentControllerRef)) {
		return OPENMELD_REMOTE_AGENT_CONTROL_LABEL;
	}
	if (!input.controllerDisplay) {
		return null;
	}
	if (
		input.controllerDisplay.trim() === OPENMELD_REMOTE_AGENT_CONTROLLER_DISPLAY
	) {
		return OPENMELD_REMOTE_AGENT_CONTROL_LABEL;
	}

	const controllerLocation = input.runtimeDeviceDisplayName
		? `${input.runtimeDeviceDisplayName} ${input.controllerDisplay}`
		: input.controllerDisplay;
	return `Controlled by ${controllerLocation}`;
}
