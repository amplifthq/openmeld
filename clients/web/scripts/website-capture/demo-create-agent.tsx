import { HOSTED_REMOTE_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import { listLocalAgentInstallGuides } from "@openmeld/product-catalog/local-agent-install-guides";
import { useState } from "react";
import { RemoteAgentAvatar } from "../../src/components/agents/remote-agent-avatar";
import { AgentNameEditor } from "../../src/components/profiles/agent-name-editor";
import { AgentRuntimeChoice } from "../../src/components/profiles/agent-runtime-choice";
import { LocalAgentSelector } from "../../src/components/profiles/local-agent-selector";

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
	const selected = choices.find((choice) => choice.value === agent);
	const key = runtime === "local" ? agent : "remote";
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8 sm:p-12">
			<h1 className="font-medium text-2xl">Create Agent</h1>
			<AgentRuntimeChoice onChange={setRuntime} runtime={runtime} />
			{runtime === "local" ? (
				<LocalAgentSelector
					choices={choices}
					disabled={false}
					isResolving={false}
					onChange={setAgent}
					surface="page"
					value={agent}
				/>
			) : (
				<div className="flex items-center gap-4">
					<RemoteAgentAvatar
						agentControllerRef={HOSTED_REMOTE_AGENT_CONTROLLER_REF}
						animateOnHover={false}
						profileName="Research assistant"
						size={64}
					/>
					<div>
						<p className="font-medium">OpenMeld Remote Agent</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Work with files, tools, and a browser in the cloud.
						</p>
					</div>
				</div>
			)}
			<AgentNameEditor
				onChange={(value) =>
					setNames((current) => ({ ...current, [key]: value }))
				}
				value={
					names[key] ??
					(runtime === "local"
						? `Maya’s ${selected?.label}`
						: "Research assistant")
				}
			/>
		</div>
	);
}
