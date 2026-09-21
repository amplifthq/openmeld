"use client";

import { Button } from "@openmeld/ui/components/button";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import {
	MagnifyingDock,
	MagnifyingDockItem,
} from "@openmeld/ui/components/magnifying-dock";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { Switch } from "@openmeld/ui/components/switch";
import { cn } from "@openmeld/ui/lib/utils";
import { CheckIcon, RobotIcon } from "@phosphor-icons/react";
import { type ReactNode, useId, useState } from "react";
import { ComputerSetupChoiceCard } from "#/components/connect/computer-setup-choice-card";
import { DesktopAwareLink } from "#/desktop/desktop-aware-link";
import type { AgentProfileBindingChoice } from "./agent-binding-choice-list";
import { AgentCreationComputerRecoveryPanel } from "./agent-creation-computer-recovery";
import type {
	AgentProfileLocalAgentEmptyState,
	AgentProfileLocalAgentSelectionState,
} from "./create-profile-form";

export type LocalAgentSelectorProps = {
	choices: readonly AgentProfileBindingChoice[];
	computerSlot?: ReactNode;
	computerRecovery?: import("./agent-creation-computer-recovery").AgentCreationComputerRecovery;
	disabled: boolean;
	emptyState?: AgentProfileLocalAgentEmptyState;
	isResolving: boolean;
	locked?: boolean;
	onChange: (value: string) => void;
	surface?: "dialog" | "page";
	selectionState?: AgentProfileLocalAgentSelectionState | null;
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
					choices.length > 0 ? "mb-1" : "mb-4",
					heading === "Choose a local agent" && "sr-only"
				)}
				id={headingId}
			>
				{heading}
			</legend>
			{input.computerSlot}
			{input.locked ? (
				<p className="text-pretty text-muted-foreground text-sm leading-5">
					This Agent will keep using the agent connected to this Session.
				</p>
			) : null}

			{input.isResolving && choices.length === 0 ? (
				<output
					aria-label="Checking available local agents"
					className="flex min-h-24 items-center justify-start gap-3"
				>
					<Skeleton className="size-16 rounded-lg" />
					<Skeleton className="size-16 rounded-lg" />
					<Skeleton className="size-16 rounded-lg" />
				</output>
			) : null}

			{choices.length > 0 ? (
				<MagnifyingDock
					aria-labelledby={headingId}
					className="-mx-3 min-h-24 justify-start gap-2 overflow-x-auto overflow-y-hidden px-3 pt-5 pb-1"
				>
					{choices.map((choice, index) => {
						const selected = choice.value === input.value;
						return (
							<MagnifyingDockItem
								caption={choice.label}
								captionClassName={cn(
									"max-w-20",
									selected && "font-medium text-foreground"
								)}
								key={choice.value}
								style={{ zIndex: choices.length - index }}
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

			{selectedChoice &&
			input.selectionState &&
			input.selectionState.kind !== "available" ? (
				<LocalAgentSelectionStatePanel
					computerRecovery={input.computerRecovery}
					key={
						input.selectionState.selectionKey ?? input.selectionState.agentId
					}
					state={input.selectionState}
				/>
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

function LocalAgentSelectionStatePanel(input: {
	computerRecovery?: import("./agent-creation-computer-recovery").AgentCreationComputerRecovery;
	state: AgentProfileLocalAgentSelectionState;
}) {
	const [enableRequested, setEnableRequested] = useState(false);
	const [enableError, setEnableError] = useState<string | null>(null);
	const state = input.state;
	const className =
		"grid min-h-40 content-center gap-4 rounded-md border border-border/70 border-dashed bg-card/25 px-6 py-7";

	if (state.kind === "computer" && input.computerRecovery) {
		return (
			<div className={className}>
				<AgentCreationComputerRecoveryPanel recovery={input.computerRecovery} />
			</div>
		);
	}
	if (state.kind === "checking") {
		return (
			<output
				aria-label={`Checking ${state.displayName}`}
				className={className}
			>
				<div className="grid gap-2">
					<Skeleton className="h-4 w-40" />
					<Skeleton className="h-3 w-full max-w-md" />
				</div>
			</output>
		);
	}
	if (state.kind === "disabled") {
		return (
			<section
				aria-label={`${state.displayName} availability`}
				className={className}
			>
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div className="grid gap-1.5">
						<h3 className="font-medium text-sm">
							{state.displayName} is turned off on this computer.
						</h3>
						<p className="text-muted-foreground text-xs leading-5">
							Turn it on here or in Computer → Local agents.
						</p>
					</div>
					<Switch
						aria-label={`Enable ${state.displayName}`}
						checked={enableRequested}
						disabled={enableRequested || !state.canEnable || !state.onEnable}
						onCheckedChange={(enabled) => {
							if (!(enabled && state.onEnable)) {
								return;
							}
							setEnableRequested(true);
							setEnableError(null);
							state
								.onEnable()
								.then(() => {
									setEnableRequested(false);
								})
								.catch(() => {
									setEnableRequested(false);
									setEnableError(
										`Couldn’t turn on ${state.displayName}. Try again.`
									);
								});
						}}
					/>
				</div>
				{enableError ? (
					<p className="text-destructive text-xs" role="alert">
						{enableError}
					</p>
				) : null}
				{!state.canEnable && state.manageHref ? (
					<DesktopAwareLink
						className="w-fit font-medium text-sm underline underline-offset-4"
						href={state.manageHref}
					>
						Open Computer settings
					</DesktopAwareLink>
				) : null}
			</section>
		);
	}

	const content = resolveSelectionStateContent(state);
	return (
		<section
			aria-label={`${state.displayName} availability`}
			className={className}
		>
			<div className="grid gap-1.5">
				<h3 className="font-medium text-sm">{content.title}</h3>
				<p className="max-w-xl text-muted-foreground text-xs leading-5">
					{content.description}
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{state.guideHref ? (
					<DesktopAwareLink
						className="inline-flex min-h-9 items-center font-medium text-sm underline underline-offset-4"
						href={state.guideHref}
					>
						{state.kind === "not_installed"
							? "Open install guide"
							: "Open setup guide"}
					</DesktopAwareLink>
				) : null}
				{state.onRetry ? (
					<Button
						onClick={state.onRetry}
						size="sm"
						type="button"
						variant="outline"
					>
						Check again
					</Button>
				) : null}
			</div>
		</section>
	);
}

function resolveSelectionStateContent(
	state: AgentProfileLocalAgentSelectionState
): { description: string; title: string } {
	switch (state.kind) {
		case "not_installed":
			return {
				title: `Install ${state.displayName} on this computer.`,
				description:
					"Install it, finish its first-run setup, then check again.",
			};
		case "signed_out":
			return {
				title: `Sign in to ${state.displayName} on this computer.`,
				description: state.blocksCreation
					? "Finish sign-in, then check again."
					: "You can create this Agent now, but sign in before you try to run it.",
			};
		case "check_failed":
			return {
				title: `Couldn’t check ${state.displayName}.`,
				description: "Check again to load its current status.",
			};
		default:
			return {
				title: `${state.displayName} isn’t available on this computer.`,
				description:
					state.message ??
					"Fix its setup, then check again before creating this Agent.",
			};
	}
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
				actionHref={
					emptyState.onConnectComputer
						? undefined
						: (emptyState.primaryActionHref ?? undefined)
				}
				actionLabel="Connect Computer"
				centerAgentHref={emptyState.centerAgentHref}
				className={className}
				descriptionLead="Connect a computer to choose a local agent."
				onAction={emptyState.onConnectComputer}
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
			descriptionLead="No local agents are available to select. Set up a supported local agent, then return to finish creating your Agent."
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
