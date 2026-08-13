"use client";

import { Button } from "@openmeld/ui/components/button";
import { Card } from "@openmeld/ui/components/card";
import { LocalAgentLogo as LocalAgentBrandLogo } from "@openmeld/ui/components/local-agent-logo";
import { ArrowRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { BringAgentsSetupProvider } from "#/components/connect/bring-agents-setup-context";
import { ComputerSetupFlow } from "#/components/connect/start-bring-agents-setup-page";
import { DEFAULT_CONNECT_ROUTE_INTENT } from "#/lib/connect/connect-route";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationOnboardingPath } from "#/lib/organizations/organization-routes";

export function LocalAgentsOnboardingStep(input: { onContinue: () => void }) {
	const { currentOrganization } = useAppOrganization();
	const onboardingPath = buildOrganizationOnboardingPath(
		currentOrganization.slug
	);
	return (
		<div className="flex flex-1 flex-col">
			<div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
				<LocalAgentLogo
					icon={
						<LocalAgentBrandLogo
							agentId="builtin:codex"
							className="size-8"
							size="md"
						/>
					}
					label="Codex"
				/>
				<LocalAgentLogo
					icon={
						<LocalAgentBrandLogo
							agentId="builtin:claude-code"
							className="size-8"
							size="md"
						/>
					}
					label="Claude Code"
				/>
				<LocalAgentLogo
					icon={
						<LocalAgentBrandLogo
							agentId="builtin:cursor"
							className="size-8"
							size="md"
						/>
					}
					label="Cursor"
				/>
				<LocalAgentLogo
					icon={
						<LocalAgentBrandLogo
							agentId="builtin:grok-build"
							className="size-8"
							size="md"
						/>
					}
					label="Grok Build"
				/>
				<LocalAgentLogo
					icon={
						<LocalAgentBrandLogo
							agentId="builtin:opencode"
							className="size-8"
							size="md"
						/>
					}
					label="OpenCode"
				/>
			</div>
			<p className="mb-5 text-muted-foreground text-sm leading-6">
				Run one command. OpenMeld connects this computer and finds the agents
				already installed.
			</p>
			<div className="flex-1">
				<BringAgentsSetupProvider routeIntent={DEFAULT_CONNECT_ROUTE_INTENT}>
					<ComputerSetupFlow
						autoReturnOnCompletion={false}
						orgSlug={currentOrganization.slug}
						preferExistingConnection
						presentation="embedded"
						selfRoute={onboardingPath}
					/>
				</BringAgentsSetupProvider>
			</div>
			<div className="mt-6 flex items-center justify-between gap-4 border-border/70 border-t pt-5">
				<p className="text-muted-foreground text-xs">
					Optional. Continue while setup runs, or come back later.
				</p>
				<Button onClick={input.onContinue} type="button">
					Continue
					<ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
				</Button>
			</div>
		</div>
	);
}

function LocalAgentLogo(input: { icon: ReactNode; label: string }) {
	return (
		<Card className="flex min-w-0 flex-col items-center gap-2 rounded-md px-2 py-4">
			<span aria-hidden="true" className="grid size-10 place-items-center">
				{input.icon}
			</span>
			<span className="max-w-full truncate text-center text-[11px] text-muted-foreground">
				{input.label}
			</span>
		</Card>
	);
}
