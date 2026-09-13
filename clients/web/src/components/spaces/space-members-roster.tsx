"use client";

import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import type {
	SpaceMemberDirectory,
	SpaceMemberDirectoryEntry,
} from "@openmeld/space";
import { type ReactNode, useId, useState } from "react";
import { ProfileListItem } from "#/components/profiles/profile-list-item";
import { SpacePersonAgentGroup } from "./people-agent-picker-candidates";
import { SpaceProfileIcon } from "./space-profile-icon";

export function SpaceMembersRosterView(input: {
	roster: SpaceMembersRoster;
	searchActive: boolean;
	renderMember: (entry: SpaceMemberDirectoryEntry) => ReactNode;
}) {
	const id = useId();
	const { roster, renderMember: renderMemberRow } = input;
	const [collapsedPersonProfileIds, setCollapsedPersonProfileIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	return (
		<div className="flex flex-col gap-3">
			{roster.organizationEntries.length > 0 ? (
				<section className="flex flex-col gap-1">
					<h2 className="font-medium text-muted-foreground text-xs">
						Organization
					</h2>
					<div className="flex flex-col">
						{roster.organizationEntries.map((entry) => (
							<div key={entry.id}>{renderMemberRow(entry)}</div>
						))}
					</div>
				</section>
			) : null}
			{roster.personGroups.length > 0 ? (
				<section className="flex flex-col gap-1">
					<h2 className="font-medium text-muted-foreground text-xs">
						People &amp; Agents
					</h2>
					<div className="flex flex-col gap-1">
						{roster.personGroups.map((group) => {
							const expanded =
								input.searchActive || !collapsedPersonProfileIds.has(group.id);
							return (
								<SpacePersonAgentGroup
									agentsId={`${id}-${group.id}-agents`}
									expanded={expanded}
									header={
										<div className="min-w-0 flex-1">
											{group.humanEntry ? (
												renderMemberRow(group.humanEntry)
											) : (
												<ProfileListItem
													className="px-1.5 py-2"
													compact
													icon={
														<SpaceProfileIcon
															agentControllerRef={null}
															avatarImageUrl={group.avatarUrl}
															profileId={group.id}
															profileKind="human"
															profileName={group.name}
														/>
													}
													profileName={group.name}
													profileNameClassName="text-[13px] sm:text-[13px]"
												/>
											)}
										</div>
									}
									key={group.id}
									name={group.name}
									onExpandedChange={(nextExpanded) => {
										setCollapsedPersonProfileIds((current) => {
											const next = new Set(current);
											if (nextExpanded) {
												next.delete(group.id);
											} else {
												next.add(group.id);
											}
											return next;
										});
									}}
									showToggle={group.agentEntries.length > 0}
									toggleClassName="mt-1.5"
								>
									<div className="ml-7 flex flex-col">
										{group.agentEntries.map((entry) => (
											<div key={entry.id}>{renderMemberRow(entry)}</div>
										))}
									</div>
								</SpacePersonAgentGroup>
							);
						})}
					</div>
				</section>
			) : null}
			{roster.ungroupedAgentEntries.length > 0 ? (
				<section className="flex flex-col gap-1">
					<h2 className="font-medium text-muted-foreground text-xs">Agents</h2>
					<div className="flex flex-col">
						{roster.ungroupedAgentEntries.map((entry) => (
							<div key={entry.id}>{renderMemberRow(entry)}</div>
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}

type SpaceMembersPersonGroup = {
	agentEntries: readonly SpaceMemberDirectoryEntry[];
	humanEntry: SpaceMemberDirectoryEntry | null;
	id: string;
	name: string;
	avatarUrl: string | null;
};

type SpaceMembersRoster = {
	organizationEntries: readonly SpaceMemberDirectoryEntry[];
	personGroups: readonly SpaceMembersPersonGroup[];
	ungroupedAgentEntries: readonly SpaceMemberDirectoryEntry[];
};

export function buildSpaceMembersRoster(input: {
	centerAgentProfileId: string | null;
	directory: SpaceMemberDirectory | null;
	filteredDirectory: SpaceMemberDirectory | null;
	searchActive: boolean;
	owners?: OrganizationProfileDirectoryResponse["members"];
}): SpaceMembersRoster {
	const emptyRoster: SpaceMembersRoster = {
		organizationEntries: [],
		personGroups: [],
		ungroupedAgentEntries: [],
	};
	if (!(input.directory && input.filteredDirectory)) {
		return emptyRoster;
	}
	const allHumanEntries =
		input.directory.sections.find((section) => section.id === "humans")
			?.entries ?? [];
	const allAgentEntries =
		input.directory.sections.find((section) => section.id === "agents")
			?.entries ?? [];
	const visibleProfileIds = new Set(
		input.filteredDirectory.sections.flatMap((section) =>
			section.entries.map((entry) => entry.profileId)
		)
	);
	const regularAgentEntries = allAgentEntries.filter(
		(entry) => entry.profileId !== input.centerAgentProfileId
	);
	const assignedAgentProfileIds = new Set<string>();
	const personGroups = allHumanEntries.flatMap(
		(humanEntry): readonly SpaceMembersPersonGroup[] => {
			const ownedAgentEntries = regularAgentEntries.filter(
				(agentEntry) =>
					humanEntry.ownerUserId !== null &&
					agentEntry.ownerUserId === humanEntry.ownerUserId
			);
			for (const agentEntry of ownedAgentEntries) {
				assignedAgentProfileIds.add(agentEntry.profileId);
			}
			const humanMatches = visibleProfileIds.has(humanEntry.profileId);
			const visibleAgentEntries = humanMatches
				? ownedAgentEntries
				: ownedAgentEntries.filter((entry) =>
						visibleProfileIds.has(entry.profileId)
					);
			if (
				input.searchActive &&
				!humanMatches &&
				visibleAgentEntries.length === 0
			) {
				return [];
			}
			return [
				{
					agentEntries: visibleAgentEntries,
					humanEntry,
					id: humanEntry.profileId,
					name: humanEntry.profileName,
					avatarUrl: humanEntry.avatarUrl,
				},
			];
		}
	);
	const organizationEntries = allAgentEntries.filter(
		(entry) =>
			entry.profileId === input.centerAgentProfileId &&
			(!input.searchActive || visibleProfileIds.has(entry.profileId))
	);
	const unmatchedAgentEntries = regularAgentEntries.filter(
		(entry) => !assignedAgentProfileIds.has(entry.profileId)
	);
	const ownerGroups = new Map<string, SpaceMembersPersonGroup>();
	for (const entry of unmatchedAgentEntries) {
		if (!entry.ownerUserId) {
			continue;
		}
		const owner = input.owners?.find(
			(member) => member.userId === entry.ownerUserId
		);
		const name = owner?.humanProfile?.profileName ?? entry.ownerName;
		if (!name) {
			continue;
		}
		const existing = ownerGroups.get(entry.ownerUserId);
		ownerGroups.set(entry.ownerUserId, {
			agentEntries: [...(existing?.agentEntries ?? []), entry],
			humanEntry: null,
			id: owner?.humanProfile?.profileId ?? entry.ownerUserId,
			name,
			avatarUrl: owner?.user.image ?? null,
		});
		assignedAgentProfileIds.add(entry.profileId);
	}
	for (const group of ownerGroups.values()) {
		const agentEntries = input.searchActive
			? group.agentEntries.filter((entry) =>
					visibleProfileIds.has(entry.profileId)
				)
			: group.agentEntries;
		if (agentEntries.length > 0) {
			personGroups.push({ ...group, agentEntries });
		}
	}
	const ungroupedAgentEntries = unmatchedAgentEntries.filter(
		(entry) =>
			!assignedAgentProfileIds.has(entry.profileId) &&
			(!input.searchActive || visibleProfileIds.has(entry.profileId))
	);
	return {
		organizationEntries,
		personGroups,
		ungroupedAgentEntries,
	};
}
