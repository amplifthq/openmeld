"use client";

import { Card, CardContent } from "@openmeld/ui/components/card";
import { SettingsComputerSummaryCardContent } from "@openmeld/ui/components/settings-computers";
import { cardPickerCardClassName } from "@openmeld/ui/lib/card-picker-contract";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { buildOrganizationComputerPath } from "#/lib/organizations/organization-routes";
import {
	formatAgentCount,
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
					lastSeenLabel={formatComputerAgentNames(input.computer)}
					localAgentsSummaryLabel={formatAgentCount(
						input.computer.agents.length
					)}
					name={input.computer.deviceDisplayName}
					platformLabel={`Owned by ${input.computer.ownerLabel}`}
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
					lastSeenLabel={formatComputerAgentNames(input.computer)}
					localAgentsSummaryLabel={formatAgentCount(
						input.computer.agents.length
					)}
					name={input.computer.deviceDisplayName}
					platformLabel={`Owned by ${input.computer.ownerLabel}`}
				/>
				<CardContent className="border-border/70 border-t py-4">
					<h2 className="font-medium text-foreground text-sm">Agents</h2>
					<ul className="mt-2 space-y-1.5">
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
			<p className="text-muted-foreground text-sm leading-6">
				{input.computer.ownerLabel} owns this computer. Ask them to update its
				connection or settings.
			</p>
		</div>
	);
}

function formatComputerAgentNames(computer: OrganizationComputer): string {
	const names = computer.agents.map((agent) => agent.profileName);
	if (names.length === 0) {
		return "No organization Agents";
	}
	if (names.length === 1) {
		return names[0] ?? "1 Agent";
	}
	if (names.length === 2) {
		return `${names[0]} and ${names[1]}`;
	}
	return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
