import { listLocalAgentInstallGuides } from "@openmeld/product-catalog/local-agent-install-guides";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { useState } from "react";
import { personalRemoteModelChoices } from "../../src/components/models/hosted-model-select";
import { modelProviderBrandName } from "../../src/components/models/model-brand";
import { ModelBrandIcon } from "../../src/components/models/model-brand-icon";
import { AgentNameEditor } from "../../src/components/profiles/agent-name-editor";
import { AgentRuntimeChoice } from "../../src/components/profiles/agent-runtime-choice";
import { LocalAgentSelector } from "../../src/components/profiles/local-agent-selector";
import { PersonalRemoteAgentConfiguration } from "../../src/components/profiles/personal-remote-agent-configuration";
import { demoModelCatalog as modelCatalog } from "./demo-model-catalog";

const providerBrands = [
	...new Set(
		personalRemoteModelChoices(modelCatalog)
			.map((choice) => modelProviderBrandName(choice.modelId))
			.filter((brand): brand is string => brand !== null && brand !== "xAI")
	),
].slice(0, 5);

function RemoteProviderLogos() {
	return (
		<Tooltip>
			<TooltipTrigger
				aria-label="Supported cloud model providers"
				render={
					<span className="isolate inline-flex shrink-0 items-center -space-x-1.5 align-middle" />
				}
			>
				{providerBrands.map((brand, index) => (
					<span
						aria-hidden="true"
						className="relative grid size-5 place-items-center rounded-sm border border-border bg-surface-2"
						key={brand}
						style={{ zIndex: providerBrands.length - index }}
					>
						<ModelBrandIcon brand={brand} className="size-3.5" />
					</span>
				))}
			</TooltipTrigger>
			<TooltipContent side="top">{providerBrands.join(", ")}</TooltipContent>
		</Tooltip>
	);
}

const choices = listLocalAgentInstallGuides().map((agent) => ({
	agentId: `builtin:${agent.agentId}`,
	value: `builtin:${agent.agentId}`,
	label: agent.displayName,
	description: "Runs on Maya’s computer.",
}));

export function DemoCreateAgent() {
	const [runtime, setRuntime] = useState<"local" | "remote">("local");
	const [agent, setAgent] = useState(choices[0].value);
	const [names, setNames] = useState<Record<string, string>>({});
	const [model, setModel] = useState("anthropic/claude-opus-5.5");
	const [reasoningLevel, setReasoningLevel] = useState("");
	const selected = choices.find((choice) => choice.value === agent);
	const key = runtime === "local" ? agent : "remote";
	const name =
		names[key] ??
		(runtime === "local" ? `Maya’s ${selected?.label}` : "Research assistant");
	const changeName = (value: string) =>
		setNames((current) => ({ ...current, [key]: value }));
	return (
		<div className="demo-create-agent mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8">
			<h1 className="font-medium text-2xl">Create Agent</h1>
			<AgentRuntimeChoice
				onChange={setRuntime}
				remoteAgentAccessory={<RemoteProviderLogos />}
				runtime={runtime}
			/>
			{runtime === "local" ? (
				<>
					<LocalAgentSelector
						choices={choices}
						disabled={false}
						isResolving={false}
						onChange={setAgent}
						surface="page"
						value={agent}
					/>
					<AgentNameEditor onChange={changeName} value={name} />
				</>
			) : (
				<PersonalRemoteAgentConfiguration
					isSubmitting={false}
					model={model ?? ""}
					modelCatalog={modelCatalog}
					name={name}
					onModelChange={(value) => {
						setModel(value);
						setReasoningLevel("");
					}}
					onNameChange={changeName}
					onReasoningLevelChange={setReasoningLevel}
					reasoningLevel={reasoningLevel}
				/>
			)}
		</div>
	);
}
