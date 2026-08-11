import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import { resolvePublicAgentAvailabilityCopy } from "@openmeld/schemas";

const MANUAL_ONLY_AGENT_RECOVERY_REASON_CODES = new Set<string>([
	"agent_profile_binding.missing",
	"profile.unbound",
]);

export const MANUAL_ONLY_AGENT_BADGE_LABEL = "Manually controlled";
export const MANUAL_ONLY_AGENT_DETAIL = resolveManualOnlyAgentDetail();

function resolveManualOnlyAgentDetail(): string {
	const detail = resolvePublicAgentAvailabilityCopy(
		"agent_profile_binding.missing"
	)?.manualOnlyAgentDetail;
	if (!detail) {
		throw new Error(
			"Shared Agent Profile Binding copy is missing manual-only detail"
		);
	}
	return detail;
}

export function isManualOnlyAgentRecoveryPlan(
	plan: AgentProfileReplyRecoveryPlan | null | undefined
): boolean {
	return Boolean(
		plan &&
			plan.kind !== "none" &&
			MANUAL_ONLY_AGENT_RECOVERY_REASON_CODES.has(plan.recoveryReasonCode)
	);
}
