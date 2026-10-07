"use client";

import type { PluginDefinition } from "@openmeld/product-catalog/plugins";
import type { ReactNode } from "react";
import { CenterAgentGitHubConnectionCard } from "./center-agent-github-connection-card";
import { PluginAgentAccess } from "./plugin-agent-access";
import { PluginConnectionCard } from "./plugin-connection-card";

type PluginConnectionSurfaceProps = {
	plugin: Extract<PluginDefinition, { availability: "available" }>;
	organizationId: string;
	organizationName?: string;
	isPersonalWorkspace?: boolean;
	canManage: boolean;
	mode: "all" | "member" | "shared";
	presentation?: "management" | "onboarding" | "conversation";
	children?: (hasSavedAccess: boolean) => ReactNode;
};

/** One entry point; the existing provider flows retain authorization ownership. */
export function PluginConnectionSurface(input: PluginConnectionSurfaceProps) {
	const { plugin, presentation = "management", children, ...context } = input;
	return (
		<>
			<ProviderConnectionSurface
				{...context}
				plugin={plugin}
				presentation={presentation}
			/>
			<PluginAgentAccess
				organizationId={input.organizationId}
				organizationName={input.organizationName ?? "this organization"}
				scope={input.mode}
				service={plugin.service}
			>
				{children}
			</PluginAgentAccess>
		</>
	);
}

function ProviderConnectionSurface(
	input: Omit<PluginConnectionSurfaceProps, "children">
) {
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
