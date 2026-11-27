"use client";

import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	SettingsComputerSummaryCardContent,
	SettingsLocalAgentUsageCompactReadout,
} from "@openmeld/ui/components/settings-computers";
import { cardPickerCardClassName } from "@openmeld/ui/lib/card-picker-contract";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ColleagueAgentChatButton } from "#/components/member-agents/colleague-agent-page-sidebar";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { resolveOrganizationComputerSummaryStatus } from "#/lib/computer-summary-status";
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
					"border-transparent bg-transparent hover:border-transparent"
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
					localAgents={localAgents.map((agent) => ({
						...agent,
						muted: input.computer.serviceState !== "connected",
					}))}
					localAgentsSummaryLabel={formatLocalAgentSummaryLabel(localAgents)}
					name={input.computer.deviceDisplayName}
					platformLabel={formatOrganizationComputerPlatform(input.computer)}
					status={resolveOrganizationComputerSummaryStatus(
						input.computer.serviceState
					)}
					statusIndicatorTestId={`computer-status-dot-${input.computer.routeId}`}
				/>
			</Link>
		</div>
	);
}

export function OrganizationComputerDetail({
	computer,
}: {
	computer: OrganizationComputer;
}) {
	const rows = computer.localAgents.filter((agent) => agent.enabled);
	return (
		<section
			aria-labelledby="computer-local-agents"
			className="space-y-2"
			data-testid="organization-computer-detail"
		>
			<h2 className="font-medium text-sm" id="computer-local-agents">
				Local Agents
			</h2>
			{rows.length > 0 ? (
				<ul className="divide-y divide-border rounded-lg border border-border">
					{rows.map((agent) => (
						<OrganizationComputerLocalAgent
							agent={agent}
							computer={computer}
							key={agent.agentControllerRef}
						/>
					))}
				</ul>
			) : (
				<p className="text-muted-foreground text-sm">
					No local agents have been reported from this computer yet.
				</p>
			)}
		</section>
	);
}

function OrganizationComputerLocalAgent(input: {
	agent: OrganizationComputer["localAgents"][number];
	computer: OrganizationComputer;
}) {
	const { agent, computer } = input;
	const agentId =
		parseAgentControllerRef(agent.agentControllerRef)?.id ??
		agent.agentControllerRef;
	const name = formatLocalAgentDisplayName(agentId);
	const profiles = computer.agents.filter(
		(profile) => profile.agentControllerRef === agent.agentControllerRef
	);
	const quotaCanBeCurrent =
		computer.serviceState === "connected" && agent.status === "ready";
	const limits = (agent.details?.usageLimits ?? [])
		.filter(
			(limit) =>
				limit.usedPercent !== null &&
				limit.status !== "unsupported" &&
				limit.status !== "unavailable"
		)
		.map((limit) =>
			quotaCanBeCurrent ? limit : { ...limit, status: "stale" as const }
		);
	return (
		<li className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 px-4 py-3">
			<div className="flex min-w-0 items-start gap-3">
				<LocalAgentLogo agentId={agentId} className="mt-0.5 size-6 shrink-0" />
				<div className="min-w-0 space-y-1">
					<h3 className="font-medium text-sm">{name}</h3>
					{limits.length > 0 ? (
						<SettingsLocalAgentUsageCompactReadout
							agentName={name}
							limits={limits}
						/>
					) : (
						<p className="text-muted-foreground text-xs">Quota unavailable</p>
					)}
				</div>
			</div>
			{profiles.length > 0 ? (
				<div className="flex flex-wrap gap-2">
					{profiles.map((profile) => (
						<ColleagueAgentChatButton
							key={profile.profileId}
							ownerUserId={computer.ownerUserId}
							profileId={profile.profileId}
							profileName={profile.profileName}
						/>
					))}
				</div>
			) : null}
		</li>
	);
}

function formatOrganizationComputerLocalAgents(
	localAgents: OrganizationComputer["localAgents"]
) {
	return localAgents.map((agent) => {
		const parsed = parseAgentControllerRef(agent.agentControllerRef);
		return {
			agentId: parsed?.id ?? agent.agentControllerRef,
			displayName: formatLocalAgentDisplayName(
				parsed?.id ?? agent.agentControllerRef
			),
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
