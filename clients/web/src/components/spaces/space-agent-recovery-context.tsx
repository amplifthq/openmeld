"use client";

import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import { createContext, type PropsWithChildren, use, useMemo } from "react";
import {
	type SpaceAgentProfileBindingRecoveryPlan,
	SpaceAgentRecoveryActionControl,
} from "./space-agent-recovery-action";

type SpaceAgentRecoveryContextValue = {
	isAgentRecoveryPending: (profileId: string) => boolean;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	orgSlug?: string;
	plansByProfileId: ReadonlyMap<string, AgentProfileReplyRecoveryPlan>;
	prepareSetupHref?: string;
};

const SpaceAgentRecoveryContext =
	createContext<SpaceAgentRecoveryContextValue | null>(null);

/**
 * The current Space's Agent recovery plans, for surfaces rendered outside the
 * conversation's prop chain (the profile popover). The plans stay owned by
 * the Space landing state; this only hands them down.
 */
export function SpaceAgentRecoveryProvider(
	input: PropsWithChildren<SpaceAgentRecoveryContextValue>
) {
	const {
		children,
		isAgentRecoveryPending,
		onAgentRecoveryAction,
		orgSlug,
		plansByProfileId,
		prepareSetupHref,
	} = input;
	const value = useMemo(
		() => ({
			isAgentRecoveryPending,
			onAgentRecoveryAction,
			orgSlug,
			plansByProfileId,
			prepareSetupHref,
		}),
		[
			isAgentRecoveryPending,
			onAgentRecoveryAction,
			orgSlug,
			plansByProfileId,
			prepareSetupHref,
		]
	);
	return (
		<SpaceAgentRecoveryContext.Provider value={value}>
			{children}
		</SpaceAgentRecoveryContext.Provider>
	);
}

export function useSpaceAgentRecoveryPlan(
	profileId: string
): Exclude<AgentProfileReplyRecoveryPlan, { kind: "none" }> | null {
	const plan = use(SpaceAgentRecoveryContext)?.plansByProfileId.get(profileId);
	return plan && plan.kind !== "none" ? plan : null;
}

/**
 * The one fix action for an Agent that can't work right now, or null when
 * this viewer has no recovery for it. Shared by the Agent issue card and the
 * profile popover footer so both offer the same action.
 */
export function SpaceAgentIssueRecoveryAction(input: {
	actionLabel?: string;
	className?: string;
	profileId: string;
}) {
	const recovery = use(SpaceAgentRecoveryContext);
	const plan = useSpaceAgentRecoveryPlan(input.profileId);
	if (!(recovery?.orgSlug && plan)) {
		return null;
	}
	return (
		<SpaceAgentRecoveryActionControl
			actionLabel={input.actionLabel}
			allowComputerAction
			className={input.className}
			fromReadiness
			isPending={recovery.isAgentRecoveryPending(plan.profileId)}
			onAction={recovery.onAgentRecoveryAction}
			orgSlug={recovery.orgSlug}
			plan={plan}
			prepareSetupHref={recovery.prepareSetupHref}
		/>
	);
}
