"use client";

import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { BrainIcon, CheckIcon } from "@phosphor-icons/react";
import { useId } from "react";
import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";
import {
	AgentConfigurationCard,
	AgentConfigurationGrid,
} from "./agent-configuration-card";
import type { CreateProfileFormProps } from "./create-profile-form";

export function PersonalRemoteAgentConfiguration(input: {
	form: CreateProfileFormProps;
	name: string;
	model: string;
	onNameChange: (name: string) => void;
	onModelChange: (model: string) => void;
}) {
	const nameId = useId();
	const catalog = input.form.modelCatalog?.agentControllers["center-agent"];
	const models =
		catalog?.models.filter(
			(choice) => choice.hostedRuntime && !choice.unavailable
		) ?? [];
	const modelId = input.model || catalog?.defaultModelId || "";
	const modelName =
		models.find((choice) => choice.id === modelId)?.displayName ??
		"Loading models…";
	return (
		<div className="grid min-w-0 gap-5">
			<div className="grid justify-items-start gap-2 pt-2">
				<div
					aria-label="OpenMeld Remote Agent, selected"
					className="relative size-16"
					role="img"
				>
					<RemoteAgentAvatar
						animated
						animateOnHover={false}
						profileName={input.name}
						size={64}
					/>
					<span className="absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full border border-background bg-foreground text-background shadow-sm">
						<CheckIcon aria-hidden="true" className="size-3" weight="bold" />
					</span>
				</div>
				<span className="font-medium text-xs">OpenMeld Remote Agent</span>
			</div>
			<div className="grid min-w-0 gap-2">
				<Label htmlFor={nameId}>Agent name</Label>
				<Input
					autoComplete="off"
					disabled={input.form.isSubmitting}
					id={nameId}
					maxLength={80}
					onChange={(event) => input.onNameChange(event.target.value)}
					value={input.name}
				/>
				<p className="text-muted-foreground text-xs leading-5">
					You can rename this Agent now or later.
				</p>
			</div>
			<AgentConfigurationGrid>
				<AgentConfigurationCard
					description="Choose the model this Agent uses."
					disabled={input.form.isSubmitting || !catalog}
					icon={<BrainIcon aria-hidden="true" />}
					itemId="model"
					label="Model"
					summary={modelName}
				>
					<Select
						disabled={input.form.isSubmitting || !catalog}
						onValueChange={input.onModelChange}
						value={modelId}
					>
						<SelectTrigger
							aria-label="Model"
							className="h-10 w-full px-3 text-sm"
							displayValue={modelName}
						/>
						<SelectContent className="max-h-64">
							{models.map((choice, index) => (
								<SelectItem index={index} key={choice.id} value={choice.id}>
									{choice.displayName}
									{choice.id === catalog?.defaultModelId ? " (default)" : ""}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</AgentConfigurationCard>
			</AgentConfigurationGrid>
		</div>
	);
}
