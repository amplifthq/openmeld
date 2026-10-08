import {
	findPluginDefinition,
	LARK_CHANNEL_IDENTITY,
	SLACK_CHANNEL_IDENTITY,
} from "@openmeld/product-catalog/plugins";
import { AppLogo } from "@openmeld/ui/components/app-logo";
import { BrainIcon, FileTextIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AgentAvatarEditor } from "../../src/components/agents/agent-avatar-editor";
import {
	HostedModelSelect,
	personalRemoteModelChoices,
} from "../../src/components/models/hosted-model-select";
import {
	AgentConfigurationCard,
	AgentConfigurationEditorCard,
	AgentConfigurationGrid,
	AgentConfigurationReadoutCard,
} from "../../src/components/profiles/agent-configuration-card";
import { useDemoCenterAvatar } from "./demo-center-identity";
import { demoModelCatalog } from "./demo-model-catalog";

const modelChoices = personalRemoteModelChoices(demoModelCatalog);
const apps = ["github", "linear", "notion", "googledrive"].flatMap(
	(service) => {
		const app = findPluginDefinition(service);
		return app ? [app] : [];
	}
);
const channels = [
	{ name: "Slack", app: SLACK_CHANNEL_IDENTITY, channel: "#product" },
	{ name: "Lark", app: LARK_CHANNEL_IDENTITY, channel: "Launch team" },
] as const;

export function DemoCenterAgent() {
	const [model, setModel] = useState("openai/gpt-6-astra");
	const [avatar, setAvatar] = useDemoCenterAvatar();
	return (
		<div className="demo-center-agent">
			<header className="demo-center-identity">
				<AgentAvatarEditor
					avatarStyle={avatar}
					canEdit
					centerAgent
					modelId={model}
					onSave={async (style) => setAvatar(style)}
					profileId="demo-center-agent"
					profileName="Amplift Center Agent"
					saving={false}
					size={88}
				/>
				<div>
					<p className="mb-2 text-muted-foreground text-xs">
						Center Agent settings
					</p>
					<h1 className="font-medium text-2xl">Amplift Center Agent</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						@amplift-center-agent
					</p>
				</div>
			</header>
			<div className="demo-center-grid">
				<AgentConfigurationEditorCard
					className="demo-center-model"
					icon={<BrainIcon aria-hidden="true" />}
					label="Model"
				>
					<HostedModelSelect
						choices={modelChoices}
						onValueChange={setModel}
						value={model}
					/>
				</AgentConfigurationEditorCard>
				<AgentConfigurationGrid className="demo-center-connections">
					<AgentConfigurationReadoutCard
						itemId="demo-apps"
						label="Connected apps"
					>
						<ul className="grid gap-4">
							{apps.map((app) => (
								<li
									className="flex items-center gap-3 text-sm"
									key={app.service}
								>
									<AppLogo app={app} size="sm" surfaceLevel={2} />
									{app.name}
								</li>
							))}
						</ul>
					</AgentConfigurationReadoutCard>
					<AgentConfigurationReadoutCard
						itemId="demo-channels"
						label="Channels"
					>
						<ul className="grid gap-4">
							{channels.map(({ name, app, channel }) => (
								<li className="flex items-start gap-3 text-sm" key={name}>
									<AppLogo app={app} size="sm" surfaceLevel={2} />
									<div>
										{name}
										<p className="mt-1 text-muted-foreground text-xs">
											{channel}
										</p>
									</div>
								</li>
							))}
						</ul>
					</AgentConfigurationReadoutCard>
					<AgentConfigurationCard
						icon={<FileTextIcon aria-hidden="true" />}
						itemId="demo-team-brief"
						label="Team Brief"
						readOnly
						summary="Product launch · October"
					/>
					<AgentConfigurationCard
						description="Saved team context"
						icon={<BrainIcon aria-hidden="true" />}
						itemId="demo-memory"
						label="Organization memory"
						readOnly
						summary="On"
					/>
				</AgentConfigurationGrid>
			</div>
		</div>
	);
}
