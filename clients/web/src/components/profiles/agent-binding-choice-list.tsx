"use client";

import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { cn } from "@openmeld/ui/lib/utils";
import { useId } from "react";

const localAgentDisplaySplitPattern = /[-_]/u;

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
	onChange: (agentId: string) => void;
	value: string;
}) {
	const headingId = useId();
	const choices: AgentProfileBindingChoice[] = [
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
	const selectedIndex = choices.findIndex(
		(choice) => choice.value === input.value
	);

	return (
		<div className="grid gap-2">
			<p className="font-medium text-foreground text-sm" id={headingId}>
				Choose which local agent controls this profile
			</p>
			<RadioGroup
				aria-disabled={input.disabled || undefined}
				aria-labelledby={headingId}
				className={cn(
					"w-full gap-1",
					input.disabled && "pointer-events-none opacity-70"
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
							if (input.disabled) {
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

export function formatLocalAgentDisplayName(agentId: string): string {
	const displaySegments: string[] = [];
	for (const segment of agentId.split(localAgentDisplaySplitPattern)) {
		if (segment.length === 0) {
			continue;
		}
		displaySegments.push(segment[0]?.toUpperCase() + segment.slice(1));
	}
	return displaySegments.join(" ");
}
