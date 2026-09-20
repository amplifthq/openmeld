import { isHostedAgentControllerRef } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";

export const FUTURE_WAKES_PROJECT_SETTINGS_NOTICE =
	"This applies to future Wakes and new sessions. Your current session will not be moved.";

export function shouldShowAgentProfileProjectSettings(input: {
	agentControllerRef: string | null;
	managedRole: AuthProfileView["managedRole"];
}): boolean {
	return (
		input.managedRole === null &&
		!isHostedAgentControllerRef(input.agentControllerRef)
	);
}
