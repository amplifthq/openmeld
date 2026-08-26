import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { WrenchIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { buildOrganizationComputersPath } from "#/lib/organizations/organization-routes";
import {
	buildAgentProfilePath,
	buildProfileHomeRoutes,
} from "#/lib/profile-routes";

export type SpaceAgentProfileBindingRecoveryPlan = Extract<
	AgentProfileReplyRecoveryPlan,
	{
		kind: "connect_controller" | "turn_on_controller";
	}
>;

function isSpaceAgentProfileBindingRecoveryPlan(
	plan: AgentProfileReplyRecoveryPlan | null | undefined
): plan is SpaceAgentProfileBindingRecoveryPlan {
	return (
		plan?.kind === "connect_controller" || plan?.kind === "turn_on_controller"
	);
}

export function SpaceAgentRecoveryActionControl(input: {
	actionLabel?: string;
	className?: string;
	isPending: boolean;
	onAction: (plan: SpaceAgentProfileBindingRecoveryPlan) => Promise<void>;
	orgSlug: string;
	plan: AgentProfileReplyRecoveryPlan;
	prepareSetupHref?: string;
}) {
	const plan = input.plan;
	const orgSlug = input.orgSlug;
	const profileHomeRoutes = buildProfileHomeRoutes(orgSlug);

	if (plan.kind === "none") {
		return null;
	}

	// Computer/service-level reconnect is owned by the Get-set-up banner.
	if (plan.kind === "review_computer") {
		return null;
	}
	if (plan.primaryActionId === "manage_local_agent") {
		return (
			<Link
				className={cn(
					buttonVariants({ size: "xs", variant: "outline" }),
					"mt-1 text-foreground",
					input.className
				)}
				to={buildOrganizationComputersPath(orgSlug)}
			>
				<WrenchIcon aria-hidden="true" data-icon="inline-start" />
				{input.actionLabel ?? plan.primaryActionLabel}
			</Link>
		);
	}

	const actionLabel = input.actionLabel ?? plan.primaryActionLabel;

	if (isSpaceAgentProfileBindingRecoveryPlan(plan)) {
		return (
			<Button
				className={cn("mt-1 text-foreground", input.className)}
				disabled={input.isPending}
				onClick={() => {
					input.onAction(plan).catch((error) => {
						console.error("Failed to run agent recovery action.", error);
					});
				}}
				size="xs"
				type="button"
				variant="outline"
			>
				<WrenchIcon aria-hidden="true" data-icon="inline-start" />
				{input.isPending ? "Working..." : actionLabel}
			</Button>
		);
	}

	if (
		plan.kind === "choose_controller" ||
		plan.kind === "review_agent_profile" ||
		plan.kind === "review_provider_account"
	) {
		return (
			<Link
				className={cn(
					buttonVariants({ size: "xs", variant: "outline" }),
					"mt-1 text-foreground",
					input.className
				)}
				to={
					// Deep-link to the focused Agent Profile row so the user lands on
					// the exact agent that needs attention. review_provider_account is
					// the exception: Agent Profiles have no actionable provider-account
					// fix (only status text), so a focused row would be a dead end —
					// keep it on the Agent Profiles tab instead.
					plan.kind === "review_agent_profile" ||
					plan.kind === "choose_controller"
						? buildAgentProfilePath({ orgSlug, profileId: plan.profileId })
						: profileHomeRoutes.agents
				}
			>
				<WrenchIcon aria-hidden="true" data-icon="inline-start" />
				{actionLabel}
			</Link>
		);
	}

	// Generic fallback: prepare_agent_profile routes to the Space-recovery
	// "Connect this computer" setup page via prepareSetupHref.
	return (
		<Link
			className={cn(
				buttonVariants({ size: "xs", variant: "outline" }),
				"mt-1 text-foreground",
				input.className
			)}
			to={input.prepareSetupHref ?? buildOrganizationComputersPath(orgSlug)}
		>
			<WrenchIcon aria-hidden="true" data-icon="inline-start" />
			{actionLabel}
		</Link>
	);
}
