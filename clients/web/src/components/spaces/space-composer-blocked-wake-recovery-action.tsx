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
	hint?: string | null;
	isAgentRecoveryPending: (profileId: string) => boolean;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	orgSlug?: string;
	prepareSetupHref?: string;
}) {
	const hint = input.hint ? (
		<span className="ml-2 text-muted-foreground text-xs">{input.hint}</span>
	) : null;
	if (!(input.blockedWakeProfileId && input.orgSlug)) {
		return hint;
	}

	const plan =
		input.agentRecoveryPlansByProfileId.get(input.blockedWakeProfileId) ?? null;
	if (!plan || plan.kind === "none") {
		return hint;
	}

	return (
		<SpaceAgentRecoveryActionControl
			actionLabel={
				plan.kind === "review_computer" &&
				plan.primaryActionId === "check_status"
					? "Check connection"
					: undefined
			}
			allowComputerAction
			className="mt-0 ml-2 shrink-0 border-transparent bg-transparent text-muted-foreground shadow-none"
			isPending={input.isAgentRecoveryPending(plan.profileId)}
			onAction={input.onAgentRecoveryAction}
			orgSlug={input.orgSlug}
			plan={plan}
			prepareSetupHref={input.prepareSetupHref}
		/>
	);
}
