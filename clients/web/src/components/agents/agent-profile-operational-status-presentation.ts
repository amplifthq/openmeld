import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";

export type AgentProfileOperationalStatus =
	| "checking"
	| "idle"
	| "needs_attention"
	| "not_reported"
	| "waiting"
	| "working";

export type AgentProfileOperationalStatusPresentation = {
	label: string;
	status: AgentProfileOperationalStatus;
};

export function resolveAgentProfileOperationalStatus(
	operationalContext: AgentProfileOperationalContextInput | null
): AgentProfileOperationalStatusPresentation {
	if (!operationalContext) {
		return { label: "Not reported", status: "not_reported" };
	}
	if (operationalContext.status === "checking") {
		return { label: "Checking", status: "checking" };
	}
	if (operationalContext.status === "idle") {
		return { label: "Idle", status: "idle" };
	}
	if (operationalContext.status === "working") {
		return { label: "Agent is working", status: "working" };
	}
	if (operationalContext.recoveryAction) {
		return { label: "Needs your attention", status: "needs_attention" };
	}
	return { label: "Waiting to continue", status: "waiting" };
}
