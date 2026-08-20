"use client";

import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { cn } from "@openmeld/ui/lib/utils";
import { useId } from "react";
import { formatLocalAgentDisplayName } from "./local-agent-display-name";

type AgentProfileBindingChoice = {
	agentId: string | null;
	description: string;
	label: string;
	value: string;
};

export function AgentProfileBindingChoiceList(input: {
	availableLocalAgentIds: readonly string[];
	disabled: boolean;
	isResolving: boolean;
	locked?: boolean;
	onChange: (agentId: string) => void;
	value: string;
}) {
	const headingId = useId();
	const choices = buildAgentProfileBindingChoices(input);
	const selectedIndex = choices.findIndex(
		(choice) => choice.value === input.value
	);

	return (
		<div className="grid gap-2">
			<p className="font-medium text-foreground text-sm" id={headingId}>
				{input.locked
					? "Local agent for this Session"
					: "Choose which local agent controls this profile"}
			</p>
			<RadioGroup
				aria-disabled={input.disabled || input.locked || undefined}
				aria-labelledby={headingId}
				className={cn(
					"w-full gap-1",
					(input.disabled || input.locked) && "pointer-events-none",
					input.disabled && "opacity-70"
				)}
				selectedIndex={selectedIndex}
			>
				{choices.map((choice, index) => (
					<RadioItem
						adornment={
							choice.agentId ? (
								<LocalAgentLogo agentId={choice.agentId} size="sm" />
							) : null
						}
						className="px-4 py-3"
						description={choice.description}
						index={index}
						key={choice.value || "bind-later"}
						label={choice.label}
						onSelect={() => {
							if (input.disabled || input.locked) {
								return;
							}
							input.onChange(choice.value);
						}}
						selected={input.value === choice.value}
					/>
				))}
			</RadioGroup>
			{input.isResolving ? (
				<output aria-label="Loading local agents" className="grid gap-1">
					<Skeleton className="h-[4.25rem] w-full" />
					<Skeleton className="h-[4.25rem] w-full" />
				</output>
			) : null}
		</div>
	);
}

function buildAgentProfileBindingChoices(input: {
	availableLocalAgentIds: readonly string[];
	locked?: boolean;
	value: string;
}): AgentProfileBindingChoice[] {
	if (input.locked) {
		if (!input.value) {
			return [];
		}
		const label = formatLocalAgentDisplayName(input.value);
		return [
			{
				agentId: input.value,
				description: `This Session stays connected to ${label} on this computer.`,
				label,
				value: input.value,
			},
		];
	}
	return [
		{
			agentId: null,
			description:
				"Create this profile now and choose the controlling local agent later.",
			label: "Choose later",
			value: "",
		},
		...input.availableLocalAgentIds.map((agentId) => {
			const label = formatLocalAgentDisplayName(agentId);
			return {
				agentId,
				description: `This profile will be controlled by ${label} on this computer.`,
				label,
				value: agentId,
			};
		}),
	];
}
