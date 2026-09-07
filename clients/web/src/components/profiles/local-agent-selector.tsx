"use client";

import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import {
	MagnifyingDock,
	MagnifyingDockItem,
} from "@openmeld/ui/components/magnifying-dock";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CheckIcon,
	CloudIcon,
	DesktopTowerIcon,
	RobotIcon,
} from "@phosphor-icons/react";
import { useId } from "react";
import { ComputerSetupChoiceCard } from "#/components/connect/computer-setup-choice-card";
import type { AgentProfileBindingChoice } from "./agent-binding-choice-list";
import type { AgentProfileLocalAgentEmptyState } from "./create-profile-form";
import { LocalAgentLogoStack } from "./local-agent-logo-stack";

export type LocalAgentSelectorProps = {
	choices: readonly AgentProfileBindingChoice[];
	disabled: boolean;
	emptyState?: AgentProfileLocalAgentEmptyState;
	isResolving: boolean;
	locked?: boolean;
	onChange: (value: string) => void;
	surface?: "dialog" | "page";
	value: string;
};

export function LocalAgentSelector(input: LocalAgentSelectorProps) {
	const headingId = useId();
	const radioName = useId();
	const choices = input.choices.filter(
		(choice): choice is AgentProfileBindingChoice & { agentId: string } =>
			Boolean(choice.agentId && choice.value)
	);
	const selectedChoice = choices.find((choice) => choice.value === input.value);
	const selectedDescription = resolveSelectedChoiceDescription(selectedChoice);
	const selectionDisabled = input.disabled || input.locked === true;
	let heading = "Choose a local agent";
	if (input.isResolving || input.emptyState?.kind === "checking") {
		heading = "Checking local agents…";
	} else if (input.locked) {
		heading = "Agent connected to this Session";
	} else if (input.emptyState?.kind === "connect_computer") {
		heading = "Connect your computer to use a local agent";
	}

	return (
		<fieldset
			aria-busy={input.isResolving || undefined}
			className="grid min-w-0 gap-4"
			disabled={input.disabled}
		>
			<legend
				className={cn(
					"w-full text-left font-medium text-base",
					choices.length > 0 ? "mb-1" : "mb-4"
				)}
				id={headingId}
			>
				{input.surface === "page" ? (
					<div className="grid gap-2">
						<h1 className="font-medium text-2xl tracking-tight">
							Create Agent
						</h1>
						<p className="font-normal text-muted-foreground text-sm">
							Choose where your Agent runs.
						</p>
					</div>
				) : (
					heading
				)}
			</legend>
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="flex items-start gap-3 rounded-lg border border-border bg-muted/25 p-3">
					<DesktopTowerIcon
						aria-hidden="true"
						className="mt-0.5 size-5 shrink-0"
					/>
					<div className="space-y-1">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
							<p className="font-medium text-sm">Local Agent</p>
							<LocalAgentLogoStack compact />
						</div>
						<p className="text-muted-foreground text-xs">
							Runs on a connected computer using tools like Codex or Claude
							Code.
						</p>
					</div>
				</div>
				<button
					className="flex items-start gap-3 rounded-lg border border-border p-3 text-left text-muted-foreground"
					disabled
					type="button"
				>
					<CloudIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
					<span className="space-y-1">
						<span className="flex flex-wrap items-center gap-2 text-sm">
							<span className="font-medium">Remote Agent</span>
							<span className="text-xs">Coming soon</span>
						</span>
						<span className="block text-xs">
							Runs in the cloud without a connected computer.
						</span>
					</span>
				</button>
			</div>
			{input.locked ? (
				<p className="text-pretty text-muted-foreground text-sm leading-5">
					This Agent will keep using the agent connected to this Session.
				</p>
			) : null}

			{input.isResolving ? (
				<output
					aria-label="Checking available local agents"
					className="flex min-h-24 items-center justify-start gap-3"
				>
					<Skeleton className="size-16 rounded-lg" />
					<Skeleton className="size-16 rounded-lg" />
					<Skeleton className="size-16 rounded-lg" />
				</output>
			) : null}

			{!input.isResolving && choices.length > 0 ? (
				<MagnifyingDock
					aria-labelledby={headingId}
					className="-mx-3 min-h-24 justify-start gap-2 overflow-x-auto overflow-y-hidden px-3 pt-5 pb-1"
				>
					{choices.map((choice) => {
						const selected = choice.value === input.value;
						return (
							<MagnifyingDockItem
								caption={choice.label}
								captionClassName={cn(
									"max-w-20",
									selected && "font-medium text-foreground"
								)}
								key={choice.value}
							>
								<label
									className={cn(
										"relative grid size-16 place-items-center rounded-lg outline-none has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2",
										selectionDisabled && "cursor-default"
									)}
								>
									<input
										aria-label={resolveChoiceAccessibleName(choice)}
										checked={selected}
										className="sr-only"
										disabled={selectionDisabled}
										name={radioName}
										onChange={() => input.onChange(choice.value)}
										type="radio"
										value={choice.value}
									/>
									<LocalAgentChoiceIcon agentId={choice.agentId} />
									{selected ? (
										<span className="absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full border border-background bg-foreground text-background shadow-sm">
											<CheckIcon
												aria-hidden="true"
												className="size-3"
												weight="bold"
											/>
										</span>
									) : null}
								</label>
							</MagnifyingDockItem>
						);
					})}
				</MagnifyingDock>
			) : null}

			{!input.isResolving && choices.length === 0 ? (
				<LocalAgentSelectorEmptyState
					emptyState={input.emptyState}
					surface={input.surface}
				/>
			) : null}

			{selectedDescription ? (
				<output aria-live="polite" className="text-left">
					<p className="text-pretty text-muted-foreground text-xs leading-5">
						{selectedDescription}
					</p>
				</output>
			) : null}
		</fieldset>
	);
}

function resolveChoiceAccessibleName(
	choice: AgentProfileBindingChoice
): string {
	const description = resolveSelectedChoiceDescription(choice);
	return description ? `${choice.label}. ${description}` : choice.label;
}

function resolveSelectedChoiceDescription(
	choice: AgentProfileBindingChoice | undefined
): string | null {
	if (!choice) {
		return null;
	}
	const description = choice.description.trim();
	const redundantDescription = `${choice.label} on this computer.`;
	return description.localeCompare(redundantDescription, undefined, {
		sensitivity: "accent",
	}) === 0
		? null
		: description;
}

function LocalAgentSelectorEmptyState(input: {
	emptyState?: AgentProfileLocalAgentEmptyState;
	surface?: "dialog" | "page";
}) {
	const emptyState = input.emptyState;
	const className = cn("min-h-48", input.surface === "page" && "min-h-64");
	if (emptyState?.kind === "checking") {
		return (
			<output
				className={cn(className, "grid content-center gap-2 text-center")}
			>
				<p className="font-medium text-sm">Checking local agents…</p>
				<p className="text-muted-foreground text-sm">
					Waiting for this computer to report its local agents.
				</p>
			</output>
		);
	}
	if (emptyState?.kind === "check_failed") {
		return (
			<ComputerSetupChoiceCard
				actionLabel="Retry local agent check"
				className={className}
				descriptionLead="OpenMeld could not confirm which local agents are available. Retry the check to continue creating your Agent."
				onAction={emptyState.onRetry}
			/>
		);
	}
	if (emptyState?.kind === "connect_computer") {
		return (
			<ComputerSetupChoiceCard
				actionHref={emptyState.primaryActionHref ?? undefined}
				actionLabel="Connect Computer"
				centerAgentHref={emptyState.centerAgentHref}
				className={className}
				descriptionLead="Connect a computer so OpenMeld can check its local agents. Then return to finish creating your Agent."
			/>
		);
	}
	if (emptyState?.kind === "teammate_local_agents_unavailable") {
		return (
			<section
				className={cn(
					"grid place-items-center rounded-md border border-border/70 border-dashed bg-card/25 px-6 py-8 text-center",
					className
				)}
			>
				<div className="grid max-w-sm gap-1.5">
					<p className="font-medium text-sm">
						No local agents are available for this teammate
					</p>
					<p className="text-pretty text-muted-foreground text-xs leading-5">
						Use Advanced to request an Agent without a local agent for now.
					</p>
				</div>
			</section>
		);
	}
	return (
		<ComputerSetupChoiceCard
			actionHref={emptyState?.primaryActionHref ?? undefined}
			actionLabel="Set up local agents"
			centerAgentHref={emptyState?.centerAgentHref}
			className={className}
			descriptionLead="No local agents are available to select. Set up a local agent such as Codex or Claude Code, then return to finish creating your Agent."
		/>
	);
}

function LocalAgentChoiceIcon(input: { agentId: string }) {
	if (!hasLocalAgentLogo(input.agentId)) {
		return (
			<RobotIcon aria-hidden="true" className="size-8 text-muted-foreground" />
		);
	}

	return (
		<LocalAgentLogo
			agentId={input.agentId}
			className="size-16"
			size="md"
			variant="tile"
		/>
	);
}
