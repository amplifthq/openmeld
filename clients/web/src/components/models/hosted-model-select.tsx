"use client";

import { listCenterAgentModelChoices } from "@openmeld/agent-runtime";
import type {
	CenterAgentModelPreference,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { Label } from "@openmeld/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { type ReactNode, useId, useState } from "react";
import { ModelBadge } from "./model-badge";

export type HostedModelChoice = {
	value: string;
	modelId: string | null;
	label: string;
	badgeLabel?: string | null;
};

export function hostedModelPreferenceValue(
	preference: CenterAgentModelPreference
): string {
	return preference.kind === "system_default"
		? "system_default"
		: `model:${preference.modelId}`;
}

export function personalRemoteModelChoices(
	catalog: ModelCatalog | null
): HostedModelChoice[] {
	if (!catalog) {
		return [];
	}
	return listCenterAgentModelChoices(catalog).flatMap((choice) =>
		choice.preference.kind === "selected_model"
			? [
					{
						value: choice.preference.modelId,
						modelId: choice.preference.modelId,
						label: choice.displayName,
						badgeLabel: choice.badgeLabel,
					},
				]
			: []
	);
}

export function HostedModelSelect(input: {
	choices: readonly HostedModelChoice[];
	value: string;
	onValueChange: (value: string) => void;
	disabled?: boolean;
	modelLabel?: string;
	currentModelName?: string;
	savedValue?: string;
	action?: ReactNode;
}) {
	const id = useId();
	const [provider, setProvider] = useState("all");
	const selected = input.choices.find((choice) => choice.value === input.value);
	const providers = [
		...new Set(
			input.choices.flatMap((choice) =>
				choice.modelId ? [choice.modelId.split("/")[0]] : []
			)
		),
	].sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)));
	const choices = input.choices
		.filter(
			(choice) =>
				provider === "all" || choice.modelId?.split("/")[0] === provider
		)
		.toSorted(
			(a, b) =>
				Number(b.value === input.savedValue) -
				Number(a.value === input.savedValue)
		);
	const label = input.modelLabel ?? "Model";
	return (
		<div className="grid min-w-0 gap-4">
			<div className="grid min-w-0 gap-2">
				<Label htmlFor={`${id}-provider`}>Provider</Label>
				<Select
					disabled={input.disabled}
					onValueChange={(next) => {
						setProvider(next);
						if (next !== "all" && selected?.modelId?.split("/")[0] !== next) {
							input.onValueChange("");
						}
					}}
					value={provider}
				>
					<SelectTrigger
						aria-label="Provider"
						className="h-10 w-full px-3 text-sm"
						displayValue={
							provider === "all" ? "All providers" : providerLabel(provider)
						}
						id={`${id}-provider`}
					/>
					<SelectContent>
						<SelectItem index={0} value="all">
							All providers
						</SelectItem>
						{providers.map((item, index) => (
							<SelectItem index={index + 1} key={item} value={item}>
								{providerLabel(item)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="grid min-w-0 gap-2">
				<Label htmlFor={`${id}-model`}>{label}</Label>
				<Select
					disabled={input.disabled || choices.length === 0}
					onValueChange={input.onValueChange}
					value={input.value}
				>
					<SelectTrigger
						aria-label={label}
						className="h-10 w-full px-3 text-sm"
						displayValue={
							selected ? <ChoiceLabel choice={selected} /> : "Choose a model"
						}
						id={`${id}-model`}
					/>
					<SelectContent className="max-h-72">
						{choices.map((choice, index) => (
							<SelectItem
								aria-label={[choice.label, choice.badgeLabel]
									.filter(Boolean)
									.join(" ")}
								index={index}
								key={choice.value}
								value={choice.value}
							>
								<ChoiceLabel choice={choice} />
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{input.currentModelName ? (
					<p className="text-muted-foreground text-xs">
						Current: {input.currentModelName}
					</p>
				) : null}
			</div>
			{input.action ? <div>{input.action}</div> : null}
		</div>
	);
}

export function HostedReasoningSelect(input: {
	defaultLevel: string;
	disabled?: boolean;
	levels: readonly string[];
	onValueChange: (value: string) => void;
	value: string;
}) {
	const id = useId();
	const label = "Reasoning effort";
	const displayValue = input.value
		? reasoningLevelLabel(input.value)
		: `Default (${reasoningLevelLabel(input.defaultLevel)})`;
	return (
		<div className="grid min-w-0 gap-2">
			<Label htmlFor={id}>{label}</Label>
			<Select
				disabled={input.disabled || input.levels.length === 0}
				onValueChange={input.onValueChange}
				value={input.value}
			>
				<SelectTrigger
					aria-label={label}
					className="h-10 w-full px-3 text-sm"
					displayValue={displayValue}
					id={id}
				/>
				<SelectContent>
					<SelectItem index={0} value="">
						Default ({reasoningLevelLabel(input.defaultLevel)})
					</SelectItem>
					{input.levels.map((level, index) => (
						<SelectItem index={index + 1} key={level} value={level}>
							{reasoningLevelLabel(level)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function reasoningLevelLabel(level: string): string {
	return level[0]?.toUpperCase() + level.slice(1);
}

function ChoiceLabel({ choice }: { choice: HostedModelChoice }) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<span className="min-w-0 truncate">{choice.label}</span>
			{choice.badgeLabel ? <ModelBadge label={choice.badgeLabel} /> : null}
		</span>
	);
}

function providerLabel(id: string): string {
	const labels: Record<string, string> = {
		anthropic: "Anthropic",
		deepseek: "DeepSeek",
		google: "Google",
		meta: "Meta",
		openai: "OpenAI",
		"x-ai": "xAI",
		"z-ai": "Z.ai",
	};
	return labels[id] ?? id;
}
