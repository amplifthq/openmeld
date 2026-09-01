"use client";

import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import {
	MagnifyingDock,
	MagnifyingDockItem,
} from "@openmeld/ui/components/magnifying-dock";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { cn } from "@openmeld/ui/lib/utils";
import { CheckIcon, RobotIcon } from "@phosphor-icons/react";
import { useId } from "react";
import type { AgentProfileBindingChoice } from "./agent-binding-choice-list";

export type LocalAgentSelectorProps = {
	choices: readonly AgentProfileBindingChoice[];
	disabled: boolean;
	isResolving: boolean;
	locked?: boolean;
	onChange: (value: string) => void;
	value: string;
};

export function LocalAgentSelector(input: LocalAgentSelectorProps) {
	const headingId = useId();
	const radioName = useId();
	const choices = input.choices.filter(
		(choice): choice is AgentProfileBindingChoice & { agentId: string } =>
			Boolean(choice.agentId && choice.value)
	);
	const selectedIndex = choices.findIndex(
		(choice) => choice.value === input.value
	);
	const selectedChoice = choices[selectedIndex] ?? null;
	const selectionDisabled = input.disabled || input.locked === true;

	return (
		<fieldset
			aria-busy={input.isResolving || undefined}
			className="grid min-w-0 gap-4"
			disabled={input.disabled}
		>
			<legend
				className="w-full text-center font-medium text-base sm:text-left"
				id={headingId}
			>
				{input.locked ? "Local agent for this Session" : "Choose a local agent"}
			</legend>
			<div className="grid gap-1 text-center sm:text-left">
				<p className="text-pretty text-muted-foreground text-sm leading-5">
					{input.locked
						? "This Agent will keep using the local agent connected to this Session."
						: "Choose what will run this Agent on the selected computer."}
				</p>
			</div>

			{input.isResolving ? (
				<output
					aria-label="Checking available local agents"
					className="flex min-h-24 items-center justify-center gap-3"
				>
					<Skeleton className="size-14 rounded-2xl" />
					<Skeleton className="size-14 rounded-2xl" />
					<Skeleton className="size-14 rounded-2xl" />
				</output>
			) : null}

			{!input.isResolving && choices.length > 0 ? (
				<SharedLayoutGroup className="min-w-0">
					<MagnifyingDock
						aria-labelledby={headingId}
						className="min-h-24 justify-center gap-1 overflow-x-auto overflow-y-hidden px-3 pt-4 pb-5 sm:justify-start"
					>
						{choices.map((choice) => {
							const selected = choice.value === input.value;
							return (
								<MagnifyingDockItem
									caption={choice.label}
									captionClassName={
										selected ? "font-medium text-foreground" : undefined
									}
									key={choice.value}
								>
									<SharedLayoutItem
										indicatorClassName="rounded-2xl bg-muted/70"
										itemId={choice.value}
									>
										<label
											className={cn(
												"relative grid size-14 place-items-center rounded-2xl border bg-background/85 shadow-sm transition-[border-color,box-shadow,background-color] duration-100 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
												selected
													? "border-foreground/35 bg-muted shadow-md"
													: "border-border/70",
												selectionDisabled && "cursor-default"
											)}
										>
											<input
												aria-label={`${choice.label}. ${choice.description}`}
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
												<span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border-2 border-background bg-foreground text-background">
													<CheckIcon
														aria-hidden="true"
														className="size-3"
														weight="bold"
													/>
												</span>
											) : null}
										</label>
									</SharedLayoutItem>
								</MagnifyingDockItem>
							);
						})}
					</MagnifyingDock>
				</SharedLayoutGroup>
			) : null}

			{!input.isResolving && choices.length === 0 ? (
				<div className="rounded-xl border border-border/70 bg-muted/25 px-4 py-5 text-center">
					<p className="font-medium text-sm">No local agents are available</p>
					<p className="mt-1 text-pretty text-muted-foreground text-xs leading-5">
						Connect or enable a local agent on this computer, or use Advanced to
						create this Agent without one for now.
					</p>
				</div>
			) : null}

			{selectedChoice ? (
				<output aria-live="polite" className="grid gap-0.5 text-center">
					<p className="font-medium text-sm">{selectedChoice.label}</p>
					<p className="text-pretty text-muted-foreground text-xs leading-5">
						{selectedChoice.description}
					</p>
				</output>
			) : null}
		</fieldset>
	);
}

function LocalAgentChoiceIcon(input: { agentId: string }) {
	if (!hasLocalAgentLogo(input.agentId)) {
		return (
			<RobotIcon aria-hidden="true" className="size-7 text-muted-foreground" />
		);
	}

	return (
		<LocalAgentLogo
			agentId={input.agentId}
			className="size-9 overflow-hidden rounded-[22%]"
			size="md"
		/>
	);
}
