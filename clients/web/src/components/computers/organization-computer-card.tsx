"use client";

import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import {
	SettingsComputerSummaryCardContent,
	SettingsLocalAgentRows,
} from "@openmeld/ui/components/settings-computers";
import { cardPickerCardClassName } from "@openmeld/ui/lib/card-picker-contract";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { buildOrganizationComputerPath } from "#/lib/organizations/organization-routes";
import {
	formatOrganizationComputerLastSeen,
	type OrganizationComputer,
} from "./organization-computers";

export function OrganizationComputerPickerCard(input: {
	computer: OrganizationComputer;
	orgSlug: string;
}) {
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
					lastSeenLabel={formatOrganizationComputerLastSeen(
						input.computer.lastSeenAtMs
					)}
					localAgentsSummaryLabel={formatLocalAgentCount(
						input.computer.localAgents.length
					)}
					name={input.computer.deviceDisplayName}
					platformLabel={formatTeamComputerPlatform(input.computer)}
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
			<Card className="gap-0 py-0">
				<SettingsComputerSummaryCardContent
					lastSeenLabel={formatOrganizationComputerLastSeen(
						input.computer.lastSeenAtMs
					)}
					localAgentsSummaryLabel={formatLocalAgentCount(
						input.computer.localAgents.length
					)}
					name={input.computer.deviceDisplayName}
					platformLabel={formatTeamComputerPlatform(input.computer)}
				/>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>OpenMeld Service</CardTitle>
					<CardDescription>
						{formatServiceStatusDescription(input.computer.serviceState)}
					</CardDescription>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Local agents</CardTitle>
					<CardDescription>
						Shared status only. Accounts, versions, installation locations, and
						computer settings stay private to {input.computer.ownerLabel}.
					</CardDescription>
				</CardHeader>
				<CardContent className="border-border/70 border-t py-4">
					{input.computer.localAgents.length > 0 ? (
						<SettingsLocalAgentRows
							rows={input.computer.localAgents.map((agent) => ({
								description: formatTeamLocalAgentStatus(agent),
								displayName: formatAgentControllerName(
									agent.agentControllerRef
								),
								id: agent.agentControllerRef,
								logoAgentId:
									parseAgentControllerRef(agent.agentControllerRef)?.id ??
									agent.agentControllerRef,
							}))}
						/>
					) : (
						<p className="text-muted-foreground text-sm">
							No local agents have been reported from this computer yet.
						</p>
					)}
				</CardContent>
			</Card>
			{input.computer.agents.length > 0 ? (
				<Card>
					<CardHeader>
						<CardTitle>Agent Profiles</CardTitle>
					</CardHeader>
					<CardContent className="border-border/70 border-t py-4">
						<ul className="space-y-1.5">
							{input.computer.agents.map((agent) => (
								<li
									className="text-muted-foreground text-sm"
									key={agent.profileId}
								>
									{agent.profileName}
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			) : null}
			<p className="text-muted-foreground text-sm leading-6">
				{input.computer.ownerLabel} owns this computer. Ask them to update its
				connection or settings.
			</p>
		</div>
	);
}

function formatTeamComputerPlatform(computer: OrganizationComputer): string {
	const deviceType =
		computer.deviceType === "unknown"
			? null
			: `${computer.deviceType.slice(0, 1).toUpperCase()}${computer.deviceType.slice(1)}`;
	const operatingSystem =
		computer.platformFamily === "Unknown"
			? null
			: [computer.platformFamily, computer.osVersion].filter(Boolean).join(" ");
	return [deviceType, operatingSystem, `Owned by ${computer.ownerLabel}`]
		.filter(Boolean)
		.join(" · ");
}

function formatLocalAgentCount(count: number): string {
	return count === 1 ? "1 Local agent" : `${count} Local agents`;
}

function formatServiceStatusDescription(
	state: OrganizationComputer["serviceState"]
): string {
	switch (state) {
		case "connected":
			return "OpenMeld Service is connected.";
		case "needs_attention":
			return "Connected, but this computer needs an OpenMeld update before it can receive local work.";
		case "not_connected":
			return "Not connected right now. The computer owner can reconnect OpenMeld Service.";
		default:
			return "OpenMeld could not confirm this computer's connection status.";
	}
}

function formatTeamLocalAgentStatus(
	agent: OrganizationComputer["localAgents"][number]
): string {
	if (!agent.enabled) {
		return "Off on this computer";
	}
	switch (agent.status) {
		case "ready":
			return "Available on this computer";
		case "not_ready":
			return "Needs attention from the computer owner";
		case "stale":
			return "Needs a fresh check from this computer";
		default:
			return "Status not confirmed";
	}
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
