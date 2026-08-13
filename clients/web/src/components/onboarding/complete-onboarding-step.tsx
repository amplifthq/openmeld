"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	ArrowRightIcon,
	BrainIcon,
	CheckCircleIcon,
	CodeIcon,
	PlugIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import type { CompleteOnboardingState } from "./complete-onboarding-state";

export function CompleteOnboardingStep(input: {
	onContinue: () => Promise<void>;
	state: CompleteOnboardingState;
}) {
	const [isOpening, setIsOpening] = useState(false);
	const [finishError, setFinishError] = useState<string | null>(null);
	const outcomes = buildOnboardingOutcomes({
		appNames: input.state.appNames,
		channelNames: input.state.channelNames,
		computerName: input.state.computerName,
		invitationCount: input.state.invitationCount,
		isPersonal: input.state.isPersonal,
		localAgentNames: input.state.localAgentNames,
		memoryEnabled: input.state.memoryEnabled,
		organizationName: input.state.organizationName,
	});

	return (
		<div className="flex flex-1 flex-col">
			<div className="space-y-2">
				{outcomes.map((outcome) => (
					<OutcomeRow
						description={outcome.description}
						icon={outcome.icon}
						key={outcome.title}
						title={outcome.title}
					/>
				))}
			</div>

			<div className="mt-auto flex items-end justify-between gap-4 pt-7">
				<div>
					<p className="text-muted-foreground text-xs">
						Change any of these settings later.
					</p>
					{finishError ? (
						<p className="mt-2 text-destructive text-xs" role="alert">
							{finishError}
						</p>
					) : null}
				</div>
				<Button
					disabled={isOpening}
					onClick={async () => {
						setFinishError(null);
						setIsOpening(true);
						try {
							await input.onContinue();
						} catch (error) {
							console.error("OpenMeld could not finish onboarding.", {
								error,
								organizationId: input.state.organizationId,
							});
							setFinishError(
								"OpenMeld couldn’t finish setting up your workspace. Try again."
							);
							setIsOpening(false);
						}
					}}
					type="button"
				>
					{isOpening ? "Opening OpenMeld…" : "Open OpenMeld"}
					<ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
				</Button>
			</div>
		</div>
	);
}

type Outcome = {
	description: string;
	icon: ReactNode;
	title: string;
};

function buildOnboardingOutcomes(input: {
	appNames: string[];
	channelNames: string[];
	computerName: string | null;
	invitationCount: number;
	isPersonal: boolean;
	localAgentNames: string[];
	memoryEnabled: boolean | null;
	organizationName: string;
}): Outcome[] {
	const outcomes: Outcome[] = [];
	if (input.memoryEnabled) {
		outcomes.push({
			description: input.isPersonal
				? "Your Center Agent can remember useful context from Spaces and connected channels."
				: "Your Center Agent can use shared context from Spaces and connected channels.",
			icon: <BrainIcon weight="duotone" />,
			title: input.isPersonal
				? "Workspace memory is on"
				: "Organization memory is on",
		});
	}
	if (input.channelNames.length > 0) {
		outcomes.push({
			description: `Center Agent is connected to ${formatNames(input.channelNames)}.`,
			icon: <CheckCircleIcon weight="duotone" />,
			title: `Work from ${formatNames(input.channelNames)}`,
		});
	}
	if (input.appNames.length > 0) {
		outcomes.push({
			description: `Center Agent can use ${formatNames(input.appNames)} for context and actions.`,
			icon: <PlugIcon weight="duotone" />,
			title: `${formatNames(input.appNames)} connected`,
		});
	}
	if (input.computerName) {
		outcomes.push({
			description:
				input.localAgentNames.length > 0
					? `${formatNames(input.localAgentNames)} can receive work on ${input.computerName}.`
					: `OpenMeld Service is connected on ${input.computerName}.`,
			icon: <CodeIcon weight="duotone" />,
			title:
				input.localAgentNames.length > 0
					? `${formatNames(input.localAgentNames)} in the loop`
					: "This computer is connected",
		});
	}
	if (input.invitationCount > 0) {
		outcomes.push({
			description: `${input.invitationCount} ${input.invitationCount === 1 ? "teammate has" : "teammates have"} been invited to ${input.organizationName}.`,
			icon: <UsersThreeIcon weight="duotone" />,
			title: `${input.invitationCount} ${input.invitationCount === 1 ? "invite" : "invites"} sent`,
		});
	}
	if (outcomes.length === 0) {
		outcomes.push({
			description: input.isPersonal
				? "Add GitHub or connect a local agent whenever you’re ready."
				: "Add Slack, GitHub, or local agents whenever your team is ready.",
			icon: <CheckCircleIcon weight="duotone" />,
			title: "Your setup is saved",
		});
	}
	return outcomes;
}

function OutcomeRow(input: Outcome) {
	return (
		<div className="flex items-start gap-3 rounded-md border border-border/75 bg-card/25 p-3.5">
			<span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-border/65 bg-background text-foreground [&_svg]:size-4">
				{input.icon}
			</span>
			<div className="min-w-0">
				<p className="font-medium text-sm">{input.title}</p>
				<p className="mt-1 text-muted-foreground text-xs leading-5">
					{input.description}
				</p>
			</div>
		</div>
	);
}

function formatNames(names: readonly string[]): string {
	if (names.length === 0) {
		return "";
	}
	if (names.length === 1) {
		return names[0] ?? "";
	}
	if (names.length === 2) {
		return `${names[0]} and ${names[1]}`;
	}
	return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
