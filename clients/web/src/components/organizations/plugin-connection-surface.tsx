"use client";

import type { PluginDefinition } from "@openmeld/product-catalog/plugins";
import type { ReactNode } from "react";
import { CenterAgentGitHubConnectionCard } from "./center-agent-github-connection-card";
import { PluginAgentAccess } from "./plugin-agent-access";
import { PluginConnectionCard } from "./plugin-connection-card";
import type { PluginDetailLayout } from "./plugin-detail-connection";

type PluginConnectionSurfaceProps = {
	renderDetail?: PluginDetailLayout;
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
	const {
		plugin,
		presentation = "management",
		children,
		renderDetail,
		...context
	} = input;
	const access = (
		<PluginAgentAccess
			organizationId={input.organizationId}
			organizationName={input.organizationName ?? "this organization"}
			scope={input.mode}
			service={plugin.service}
		>
			{children}
		</PluginAgentAccess>
	);
	return (
		<>
			<ProviderConnectionSurface
				{...context}
				plugin={plugin}
				presentation={presentation}
				renderDetail={
					renderDetail
						? (action, content) =>
								renderDetail(
									action,
									<>
										{content}
										{access}
									</>
								)
						: undefined
				}
			/>
			{renderDetail ? null : access}
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
