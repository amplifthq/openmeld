import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import {
	type SpaceAgentProfileBindingRecoveryPlan,
	SpaceAgentRecoveryActionControl,
} from "./space-agent-recovery-action";

export function SpaceComposerBlockedWakeRecoveryAction(input: {
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	blockedWakeProfileId: string | null;
	isAgentRecoveryPending: (profileId: string) => boolean;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	orgSlug?: string;
	prepareSetupHref?: string;
}) {
	if (!(input.blockedWakeProfileId && input.orgSlug)) {
		return null;
	}

	const plan =
		input.agentRecoveryPlansByProfileId.get(input.blockedWakeProfileId) ?? null;
	if (!plan || plan.kind === "none") {
		return null;
	}

	return (
		<SpaceAgentRecoveryActionControl
			allowComputerAction
			className="mt-0 ml-2 shrink-0"
			isPending={input.isAgentRecoveryPending(plan.profileId)}
			onAction={input.onAgentRecoveryAction}
			orgSlug={input.orgSlug}
			plan={plan}
			prepareSetupHref={input.prepareSetupHref}
		/>
	);
}
