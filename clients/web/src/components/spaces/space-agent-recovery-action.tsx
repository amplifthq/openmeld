import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import { resolvePublicAgentFailureRecovery } from "@openmeld/schemas";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowSquareOutIcon, WrenchIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { buildOrganizationComputersPath } from "#/lib/organizations/organization-routes";
import {
	buildAgentProfilePath,
	buildProfileHomeRoutes,
} from "#/lib/profile-routes";
import { AgentModelRecoveryAction } from "./agent-model-recovery-action";
import { AgentWorkingFolderRecoveryAction } from "./agent-working-folder-recovery-action";

export type SpaceAgentProfileBindingRecoveryPlan = Extract<
	AgentProfileReplyRecoveryPlan,
	{
		kind: "connect_controller" | "turn_on_controller";
	}
>;

function isWorkingFolderRecovery(reasonCode: string): boolean {
	return (
		resolvePublicAgentFailureRecovery({ errorCode: reasonCode })
			?.recoveryTarget === "working_folder"
	);
}

function renderProfileSettingsRecoveryAction(input: {
	actionLabel?: string;
	className?: string;
	orgSlug: string;
	plan: Exclude<AgentProfileReplyRecoveryPlan, { kind: "none" }>;
}) {
	if (isWorkingFolderRecovery(input.plan.recoveryReasonCode)) {
		return (
			<AgentWorkingFolderRecoveryAction
				className={input.className}
				profileId={input.plan.profileId}
			/>
		);
	}
	if (input.plan.primaryActionId === "change_model") {
		return (
			<AgentModelRecoveryAction
				className={input.className}
				orgSlug={input.orgSlug}
				profileId={input.plan.profileId}
			/>
		);
	}
	if (
		resolvePublicAgentFailureRecovery({
			errorCode: input.plan.recoveryReasonCode,
		})?.recoveryTarget === "computer"
	) {
		return (
			<Link
				className={cn(
					buttonVariants({ size: "xs", variant: "outline" }),
					"mt-1 text-foreground",
					input.className
				)}
				to={buildOrganizationComputersPath(input.orgSlug)}
			>
				<WrenchIcon aria-hidden="true" data-icon="inline-start" />
				{input.actionLabel ?? input.plan.primaryActionLabel}
			</Link>
		);
	}
	return null;
}

function isSpaceAgentProfileBindingRecoveryPlan(
	plan: AgentProfileReplyRecoveryPlan | null | undefined
): plan is SpaceAgentProfileBindingRecoveryPlan {
	return (
		plan?.kind === "connect_controller" || plan?.kind === "turn_on_controller"
	);
}

export function SpaceAgentRecoveryActionControl(input: {
	actionLabel?: string;
	allowComputerAction?: boolean;
	className?: string;
	isPending: boolean;
	onAction?: (plan: SpaceAgentProfileBindingRecoveryPlan) => Promise<void>;
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
	if (plan.primaryActionId === "manage_cursor_plan") {
		return (
			<a
				className={cn(
					buttonVariants({ size: "sm", variant: "outline" }),
					"mt-1 text-foreground",
					input.className
				)}
				href="https://cursor.com/dashboard"
				rel="noreferrer"
				target="_blank"
			>
				<ArrowSquareOutIcon aria-hidden="true" data-icon="inline-start" />
				{input.actionLabel ?? plan.primaryActionLabel}
			</a>
		);
	}

	// Most Space surfaces leave Computer/service recovery to the Get-set-up
	// banner. Message details and composers opt in when the recovery plan confirms
	// that this exact Agent still needs that Computer action.
	if (plan.kind === "review_computer" && !input.allowComputerAction) {
		return null;
	}
	const settingsAction = renderProfileSettingsRecoveryAction({
		actionLabel: input.actionLabel,
		className: input.className,
		orgSlug,
		plan,
	});
	if (settingsAction) {
		return settingsAction;
	}
	if (plan.primaryActionId === "manage_local_agent") {
		return (
			<Link
				className={cn(
					buttonVariants({ size: "xs", variant: "outline" }),
					"mt-1 text-foreground",
					input.className
				)}
				to={buildAgentProfilePath({ orgSlug, profileId: plan.profileId })}
			>
				<WrenchIcon aria-hidden="true" data-icon="inline-start" />
				{input.actionLabel ?? plan.primaryActionLabel}
			</Link>
		);
	}

	const actionLabel = input.actionLabel ?? plan.primaryActionLabel;

	if (isSpaceAgentProfileBindingRecoveryPlan(plan)) {
		const onAction = input.onAction;
		if (!onAction) {
			return null;
		}
		return (
			<Button
				className={cn("mt-1 text-foreground", input.className)}
				disabled={input.isPending}
				onClick={() => {
					onAction(plan).catch((error) => {
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
