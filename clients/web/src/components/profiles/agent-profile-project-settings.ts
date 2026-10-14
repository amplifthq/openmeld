import {
	isHostedAgentControllerRef,
	resolveBuiltinAgentControllerConversationCapability,
} from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";

const BUILTIN_PREFIX = /^builtin:/u;

export const FUTURE_WAKES_PROJECT_SETTINGS_NOTICE =
	"New work uses this choice. The current task stays in its folder.";

export function shouldShowAgentProfileProjectSettings(input: {
	agentControllerRef: string | null;
	managedRole: AuthProfileView["managedRole"];
}): boolean {
	return (
		input.managedRole === null &&
		!isHostedAgentControllerRef(input.agentControllerRef) &&
		resolveBuiltinAgentControllerConversationCapability(
			input.agentControllerRef?.replace(BUILTIN_PREFIX, "") ?? ""
		)?.conversationScope !== "account_shared"
	);
}
