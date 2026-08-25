import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";

export const FUTURE_WAKES_PROJECT_SETTINGS_NOTICE =
	"This applies to future Wakes and new sessions. Your current session will not be moved.";

export function shouldShowAgentProfileProjectSettings(input: {
	agentControllerRef: string | null;
	managedRole: AuthProfileView["managedRole"];
}): boolean {
	return (
		input.managedRole === null &&
		input.agentControllerRef !== HOSTED_CENTER_AGENT_CONTROLLER_REF
	);
}
