import { buttonVariants } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowSquareOutIcon, WrenchIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { buildOrganizationComputersPath } from "#/lib/organizations/organization-routes";
import {
	buildAgentProfilePath,
	buildProfileHomeRoutes,
} from "#/lib/profile-routes";
import type { WakeFailureDisplay } from "#/lib/spaces/wake-failure-display";
import { AgentModelRecoveryAction } from "./agent-model-recovery-action";
import { AgentWorkingFolderRecoveryAction } from "./agent-working-folder-recovery-action";
import { ContinueInDefaultFolderAction } from "./continue-in-default-folder-action";

export function SpaceWakeFailureActionControl(input: {
	className?: string;
	display: WakeFailureDisplay;
	orgSlug: string;
	prepareSetupHref?: string;
	targetProfileId?: string;
}) {
	const orgSlug = input.orgSlug;
	const profileHomeRoutes = buildProfileHomeRoutes(orgSlug);
	if (input.display.actionTarget === null) {
		return null;
	}
	if (input.display.actionTarget === "session_folder") {
		return (
			<ContinueInDefaultFolderAction
				className={input.className}
				targetProfileId={input.targetProfileId}
			/>
		);
	}
	if (input.display.actionTarget === "working_folder") {
		return (
			<AgentWorkingFolderRecoveryAction
				className={input.className}
				profileId={input.targetProfileId}
			/>
		);
	}
	if (input.display.primaryActionId === "change_model") {
		return (
			<AgentModelRecoveryAction
				className={input.className}
				orgSlug={orgSlug}
				profileId={input.targetProfileId}
			/>
		);
	}
	if (input.display.actionTarget === "cursor_account") {
		return (
			<a
				className={cn(
					buttonVariants({ size: "sm", variant: "outline" }),
					"text-foreground",
					input.className
				)}
				href="https://cursor.com/dashboard"
				rel="noreferrer"
				target="_blank"
			>
				<ArrowSquareOutIcon aria-hidden="true" data-icon="inline-start" />
				{input.display.primaryActionLabel}
			</a>
		);
	}

	const href = resolveWakeFailureActionHref({
		actionTarget: input.display.actionTarget,
		orgSlug,
		prepareSetupHref: input.prepareSetupHref,
		directoryAgentsPath: profileHomeRoutes.agents,
		targetProfileId: input.targetProfileId,
	});

	return (
		<Link
			className={cn(
				buttonVariants({ size: "sm", variant: "outline" }),
				"text-foreground",
				input.className
			)}
			to={href}
		>
			<WrenchIcon aria-hidden="true" data-icon="inline-start" />
			{input.display.primaryActionLabel}
		</Link>
	);
}

function resolveWakeFailureActionHref(input: {
	actionTarget: Exclude<WakeFailureDisplay["actionTarget"], null>;
	orgSlug: string;
	prepareSetupHref?: string;
	directoryAgentsPath: string;
	targetProfileId?: string;
}): string {
	if (input.actionTarget === "prepare_setup") {
		return (
			input.prepareSetupHref ?? buildOrganizationComputersPath(input.orgSlug)
		);
	}
	if (input.actionTarget === "computer") {
		return input.targetProfileId
			? buildAgentProfilePath({
					orgSlug: input.orgSlug,
					profileId: input.targetProfileId,
				})
			: input.directoryAgentsPath;
	}
	return input.directoryAgentsPath;
}
