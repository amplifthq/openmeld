import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { useEffect, useState } from "react";
import type { OrganizationSpaceProfileCandidates } from "#/query/organizations/organization-directory";
import type {
	SpaceAddMembersCandidateGroups,
	SpaceAddMembersCandidateSummary,
} from "./people-agent-picker-model";

// Confirmed creation receipts fill the gap until the directory catches up.
// They describe identity only, never membership or Agent availability.
export function useCreatedPickerAgents(input: {
	groups: SpaceAddMembersCandidateGroups;
	organizationId: string;
	directory?: OrganizationSpaceProfileCandidates;
	snapshot?: SpaceMembersSnapshot | null;
}) {
	const [receipts, setReceipts] = useState<{
		organizationId: string;
		agents: SpaceAddMembersCandidateSummary[];
	}>({ organizationId: input.organizationId, agents: [] });
	const listedIds = new Set(
		input.groups.personGroups.flatMap((group) =>
			group.agentCandidates.map((agent) => agent.profileId)
		)
	);
	useEffect(() => {
		setReceipts((current) => {
			if (current.organizationId !== input.organizationId) {
				return { organizationId: input.organizationId, agents: [] };
			}
			const agents = current.agents.filter(
				(agent) => !listedIds.has(agent.profileId)
			);
			return agents.length === current.agents.length
				? current
				: { ...current, agents };
		});
	});
	const joinedIds = new Set(
		input.snapshot?.agents.map((agent) => agent.profileId)
	);
	const agents =
		receipts.organizationId === input.organizationId
			? receipts.agents.filter((agent) => !listedIds.has(agent.profileId))
			: [];
	const personGroups = [...input.groups.personGroups];
	for (const agent of agents) {
		if (personGroups.some((group) => group.id === agent.ownerUserId)) {
			continue;
		}
		const owner = input.directory?.members.find(
			(member) => member.userId === agent.ownerUserId
		);
		if (!owner) {
			continue;
		}
		const humanAlreadyMember = Boolean(
			input.snapshot?.humans.some(
				(member) => member.profileId === owner.humanProfile?.profileId
			)
		);
		personGroups.push({
			id: owner.userId,
			name: owner.memberName,
			searchText: owner.memberName.toLocaleLowerCase(),
			avatarImageUrl: owner.avatarImageUrl,
			lastActiveAt: owner.lastActiveAt,
			humanAlreadyMember,
			humanCandidate:
				owner.humanProfile?.status === "active" && !humanAlreadyMember
					? {
							profileId: owner.humanProfile.profileId,
							profileName: owner.humanProfile.profileName,
							profileKind: "human",
							searchText: owner.humanProfile.profileName.toLocaleLowerCase(),
						}
					: null,
			agentCandidates: [],
		});
	}
	const groups = {
		...input.groups,
		personGroups: personGroups.map((group) => ({
			...group,
			agentCandidates: [
				...group.agentCandidates,
				...agents
					.filter((agent) => agent.ownerUserId === group.id)
					.map((agent) => ({
						...agent,
						ownerHumanProfileId: group.humanCandidate?.profileId ?? null,
						alreadyMember: joinedIds.has(agent.profileId),
					})),
			],
		})),
	};
	return {
		groups,
		onCreated: (agent: SpaceAddMembersCandidateSummary) =>
			setReceipts((current) => ({
				organizationId: input.organizationId,
				agents: [
					...(current.organizationId === input.organizationId
						? current.agents.filter(
								(item) => item.profileId !== agent.profileId
							)
						: []),
					agent,
				],
			})),
	};
}
