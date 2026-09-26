"use client";

import { CenterAgentGitHubConnectionCard } from "./center-agent-github-connection-card";
import type { PluginDefinition } from "./plugin-catalog";
import { PluginConnectionCard } from "./plugin-connection-card";

type PluginConnectionSurfaceProps = {
	plugin: Extract<PluginDefinition, { availability: "available" }>;
	organizationId: string;
	organizationName?: string;
	isPersonalWorkspace?: boolean;
	canManage: boolean;
	mode: "all" | "member" | "shared";
	presentation?: "management" | "onboarding" | "conversation";
};

/** One entry point; the existing provider flows retain authorization ownership. */
export function PluginConnectionSurface(input: PluginConnectionSurfaceProps) {
	const { plugin, presentation = "management", ...context } = input;
	if (plugin.service === "github") {
		return (
			<CenterAgentGitHubConnectionCard
				key={`${input.organizationId}:${plugin.service}:${input.mode}`}
				{...context}
				presentation={presentation}
			/>
		);
	}
	return (
		<PluginConnectionCard
			{...context}
			plugin={plugin}
			presentation={presentation}
		/>
	);
}
