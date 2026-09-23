"use client";

import type { ModelCatalog } from "@openmeld/schemas/types";
import { BrainIcon, CheckIcon } from "@phosphor-icons/react";
import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";
import {
	HostedModelSelect,
	personalRemoteModelChoices,
} from "#/components/models/hosted-model-select";
import {
	AgentConfigurationCard,
	AgentConfigurationGrid,
} from "./agent-configuration-card";
import { AgentNameEditor } from "./agent-name-editor";

export function PersonalRemoteAgentConfiguration(input: {
	isSubmitting: boolean;
	modelCatalog: ModelCatalog | null;
	name: string;
	model: string;
	onNameChange: (name: string) => void;
	onModelChange: (model: string) => void;
}) {
	const catalog = input.modelCatalog?.agentControllers["center-agent"];
	const models = personalRemoteModelChoices(input.modelCatalog);
	const modelId = input.model;
	const modelName =
		models.find((choice) => choice.value === modelId)?.label ??
		(catalog ? "Choose a model" : "Loading models…");
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
			<AgentNameEditor
				disabled={input.isSubmitting}
				maxLength={80}
				onChange={input.onNameChange}
				value={input.name}
			/>
			<AgentConfigurationGrid className="@min-[64rem]/agent-creation:grid-cols-3">
				<AgentConfigurationCard
					description="Choose the model this Agent uses."
					disabled={input.isSubmitting || !catalog}
					icon={<BrainIcon aria-hidden="true" />}
					itemId="model"
					label="Model"
					summary={modelName}
				>
					<HostedModelSelect
						choices={models}
						disabled={input.isSubmitting || !catalog}
						onValueChange={input.onModelChange}
						value={modelId}
					/>
				</AgentConfigurationCard>
			</AgentConfigurationGrid>
		</div>
	);
}
