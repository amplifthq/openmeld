"use client";

import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { SettingsComputerSummaryCardContent } from "@openmeld/ui/components/settings-computers";
import { cardPickerCardClassName } from "@openmeld/ui/lib/card-picker-contract";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { LocalAgentsCard } from "#/components/agents/agents-page-local-agents";
import { OpenMeldServiceCard } from "#/components/agents/agents-page-openmeld-service";
import { buildOrganizationComputerPath } from "#/lib/organizations/organization-routes";
import {
	formatOrganizationComputerLastSeen,
	formatOrganizationComputerPlatform,
	type OrganizationComputer,
} from "./organization-computers";

export function OrganizationComputerPickerCard(input: {
	computer: OrganizationComputer;
	orgSlug: string;
}) {
	const localAgents = formatOrganizationComputerLocalAgents(
		input.computer.localAgents
	);
	return (
		<div
			className="h-full"
			data-testid={`organization-computer-card-${input.computer.routeId}`}
		>
			<Link
				aria-label={`Open ${input.computer.deviceDisplayName} details`}
				className={cn(
					cardPickerCardClassName(),
					"bg-transparent hover:border-border"
				)}
				to={buildOrganizationComputerPath({
					deviceId: input.computer.routeId,
					orgSlug: input.orgSlug,
				})}
			>
				<SettingsComputerSummaryCardContent
					activeLabel="OpenMeld Service is connected"
					lastSeenLabel={formatOrganizationComputerLastSeen(
						input.computer.lastSeenAtMs
					)}
					localAgents={localAgents}
					localAgentsSummaryLabel={formatLocalAgentSummaryLabel(localAgents)}
					name={input.computer.deviceDisplayName}
					platformLabel={formatOrganizationComputerPlatform(input.computer)}
					serviceConnectionStatus={resolveServiceConnectionStatus(
						input.computer.serviceState
					)}
				/>
			</Link>
		</div>
	);
}

export function OrganizationComputerDetail(input: {
	computer: OrganizationComputer;
}) {
	return (
		<div
			className="flex flex-col gap-4"
			data-testid="organization-computer-detail"
		>
			<OpenMeldServiceCard
				computer={{
					deviceDisplayName: input.computer.deviceDisplayName,
					openMeldTools: input.computer.openMeldTools,
					ownerLabel: input.computer.ownerLabel,
					serviceState: input.computer.serviceState,
				}}
				view="team"
			/>
			<LocalAgentsCard
				computer={{
					deviceDisplayName: input.computer.deviceDisplayName,
					localAgents: input.computer.localAgents.map((agent) => {
						const parsed = parseAgentControllerRef(agent.agentControllerRef);
						return {
							agentId: parsed?.id ?? agent.agentControllerRef,
							details: agent.details,
							displayName: formatAgentControllerName(agent.agentControllerRef),
							enabled: agent.enabled,
							status: agent.status,
						};
					}),
				}}
				view="team"
			/>
		</div>
	);
}

function resolveServiceConnectionStatus(
	serviceState: OrganizationComputer["serviceState"]
): "connected" | "not_connected" | null {
	switch (serviceState) {
		case "connected":
		case "needs_attention":
			return "connected";
		case "not_connected":
			return "not_connected";
		default:
			return null;
	}
}

function formatOrganizationComputerLocalAgents(
	localAgents: OrganizationComputer["localAgents"]
) {
	return localAgents.map((agent) => {
		const parsed = parseAgentControllerRef(agent.agentControllerRef);
		return {
			agentId: parsed?.id ?? agent.agentControllerRef,
			displayName: formatAgentControllerName(agent.agentControllerRef),
		};
	});
}

function formatLocalAgentSummaryLabel(
	localAgents: readonly { displayName: string }[]
): string {
	return localAgents.length > 0
		? localAgents.map((agent) => agent.displayName).join(", ")
		: "No local agents";
}

function formatAgentControllerName(agentControllerRef: string): string {
	const id =
		parseAgentControllerRef(agentControllerRef)?.id ?? agentControllerRef;
	const names: Record<string, string> = {
		"claude-code": "Claude Code",
		codex: "Codex",
		cursor: "Cursor",
		"grok-build": "Grok Build",
		opencode: "OpenCode",
		openclaw: "OpenClaw",
	};
	return names[id] ?? id;
}
