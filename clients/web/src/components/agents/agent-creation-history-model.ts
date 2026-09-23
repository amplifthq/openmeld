import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";

export function agentCreationNeedsAttention(
	request: AgentProfileCreationRequest,
	localSetupPending: boolean
): boolean {
	return (
		request.status === "failed" ||
		request.status === "pending" ||
		(request.status === "completed" && localSetupPending)
	);
}
