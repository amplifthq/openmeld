import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import type { SpaceProfileAddCandidate } from "@openmeld/space";
import { resolveDirectoryHumanProfileActivityLabel } from "#/components/directory/directory-human-profile-format";
import type { OrganizationSpaceProfileCandidates } from "#/query/organizations/organization-directory";
export type SpaceAddMembersCandidateSummary = {
	alreadyMember?: boolean;
	agentControllerRef?: string | null;
	availabilityCategory?: "available" | "checking" | "offline" | "unavailable";
	availabilityLabel?: string | null;
	avatarImageUrl?: string | null;
	createdAt?: string | null;
	description?: string;
	isCenterAgent?: boolean;
	lastUsedAt?: string | null;
	operationalStatus?: "checking" | "idle" | "paused" | "working";
	ownerHumanProfileId?: string | null;
	ownerUserId?: string;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
	searchText: string;
	selectionDisabled?: boolean;
};

export type SpaceAddMembersPersonGroup = {
	agentCandidates: readonly SpaceAddMembersCandidateSummary[];
	avatarImageUrl?: string | null;
	humanAlreadyMember: boolean;
	humanCandidate: SpaceAddMembersCandidateSummary | null;
	id: string;
	lastActiveAt: string | null;
	name: string;
	searchText: string;
};

export type SpaceAddMembersCandidateGroups = {
	alreadyJoinedCount: number;
	organizationCandidates: readonly SpaceAddMembersCandidateSummary[];
	personGroups: readonly SpaceAddMembersPersonGroup[];
};

export type OrganizationDirectoryAddCandidates = SpaceAddMembersCandidateGroups;

export function buildOrganizationDirectoryAddCandidates(input: {
	directory: OrganizationSpaceProfileCandidates | null;
	organizationName: string;
	snapshot: SpaceMembersSnapshot | null;
}): OrganizationDirectoryAddCandidates {
	const joinedProfileIds = new Set([
		...(input.snapshot?.humans.map((member) => member.profileId) ?? []),
		...(input.snapshot?.agents.map((member) => member.profileId) ?? []),
	]);
	let alreadyJoinedCount = 0;
	const visibleAgents = (input.directory?.agentProfiles ?? []).flatMap(
		(agent): readonly SpaceAddMembersCandidateSummary[] => {
			if (agent.status !== "active") {
				return [];
			}
			const alreadyMember = joinedProfileIds.has(agent.profileId);
			if (alreadyMember) {
				alreadyJoinedCount += 1;
			}
			return [
				{
					alreadyMember,
					agentControllerRef: agent.agentControllerRef,
					avatarImageUrl: agent.avatarUrl,
					createdAt: agent.createdAt,
					description: agent.isCenterAgent
						? `Center Agent for ${input.organizationName}`
						: undefined,
					isCenterAgent: agent.isCenterAgent === true,
					lastUsedAt: agent.lastUsedAt,
					profileId: agent.profileId,
					profileKind: "agent",
					profileName: agent.profileName,
					ownerUserId: agent.ownerUserId ?? undefined,
					searchText: normalizeAddMembersSearchText([
						agent.profileName,
						agent.profileHandle,
						agent.ownerName,
					]),
				},
			];
		}
	);
	const organizationCandidates = visibleAgents
		.filter((agent) => agent.isCenterAgent)
		.sort(compareAddMembersCandidates);
	const agentsByOwnerUserId = new Map<
		string,
		SpaceAddMembersCandidateSummary[]
	>();
	for (const agent of visibleAgents) {
		if (agent.isCenterAgent || !agent.ownerUserId) {
			continue;
		}
		const ownerAgents = agentsByOwnerUserId.get(agent.ownerUserId) ?? [];
		ownerAgents.push(agent);
		agentsByOwnerUserId.set(agent.ownerUserId, ownerAgents);
	}
	const personGroups = (input.directory?.members ?? [])
		.flatMap((member): readonly SpaceAddMembersPersonGroup[] => {
			const profile = member.humanProfile;
			const agentCandidates = (
				agentsByOwnerUserId.get(member.userId) ?? []
			).sort(compareAddMembersCandidates);
			if (profile?.status !== "active" && agentCandidates.length === 0) {
				return [];
			}
			const humanAlreadyMember = Boolean(
				profile && joinedProfileIds.has(profile.profileId)
			);
			if (humanAlreadyMember) {
				alreadyJoinedCount += 1;
			}
			const humanCandidate =
				profile?.status === "active" && !humanAlreadyMember
					? {
							avatarImageUrl: member.avatarImageUrl,
							profileId: profile.profileId,
							profileKind: "human" as const,
							profileName: profile.profileName,
							searchText: normalizeAddMembersSearchText([
								profile.profileName,
								profile.profileHandle,
								member.memberName,
							]),
						}
					: null;
			// Keep the owner's directory identity even when they are already in
			// the Space and have no Agents yet. Creation inserts into this group.
			for (const agent of agentCandidates) {
				agent.ownerHumanProfileId = profile?.profileId ?? null;
			}
			return [
				{
					agentCandidates,
					avatarImageUrl: member.avatarImageUrl,
					humanAlreadyMember,
					humanCandidate,
					id: member.userId,
					lastActiveAt: member.lastActiveAt,
					name: member.memberName,
					searchText: normalizeAddMembersSearchText([
						member.memberName,
						profile?.profileName,
						profile?.profileHandle,
					]),
				},
			];
		})
		.sort(compareAddMembersPeople);
	return {
		alreadyJoinedCount,
		organizationCandidates,
		personGroups,
	};
}

export function toAddMembersCandidateSummary(
	candidate: SpaceProfileAddCandidate
): SpaceAddMembersCandidateSummary {
	if (!candidate.profileKind) {
		throw new Error(`Unsupported profile kind for ${candidate.profileId}.`);
	}
	const ownerName = candidate.profile.ownerName?.trim();
	return {
		createdAt: candidate.profile.createdAt,
		lastUsedAt: candidate.profile.lastUsedAt,
		ownerUserId: candidate.profile.ownerUserId ?? undefined,
		profileId: candidate.profileId,
		profileKind: candidate.profileKind,
		profileName: candidate.profileName,
		searchText: normalizeAddMembersSearchText([
			candidate.profileName,
			ownerName,
		]),
	};
}

export function normalizeAddMembersSearchText(
	values: readonly (string | null | undefined)[]
): string {
	return values
		.filter((value): value is string => Boolean(value?.trim()))
		.join(" ")
		.toLocaleLowerCase();
}

export function buildSelectableAddMemberProfileIds(
	candidates: readonly SpaceAddMembersCandidateSummary[]
): ReadonlySet<string> {
	const profileIds = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate.alreadyMember) {
			profileIds.add(candidate.profileId);
		}
	}
	return profileIds;
}

export function compareAddMembersCandidates(
	left: SpaceAddMembersCandidateSummary,
	right: SpaceAddMembersCandidateSummary
): number {
	if (left.alreadyMember !== right.alreadyMember) {
		return left.alreadyMember ? -1 : 1;
	}
	if (left.isCenterAgent !== right.isCenterAgent) {
		return left.isCenterAgent ? -1 : 1;
	}
	const availabilityOrder = {
		available: 0,
		checking: 1,
		offline: 2,
		unavailable: 3,
	} as const;
	const leftAvailability = left.availabilityCategory
		? availabilityOrder[left.availabilityCategory]
		: 4;
	const rightAvailability = right.availabilityCategory
		? availabilityOrder[right.availabilityCategory]
		: 4;
	if (leftAvailability !== rightAvailability) {
		return leftAvailability - rightAvailability;
	}
	const activeWorkOrder = { working: 0, paused: 1, idle: 2, checking: 3 };
	const leftWork = left.operationalStatus
		? activeWorkOrder[left.operationalStatus]
		: 4;
	const rightWork = right.operationalStatus
		? activeWorkOrder[right.operationalStatus]
		: 4;
	if (leftWork !== rightWork) {
		return leftWork - rightWork;
	}
	const recency = compareOptionalDatesDescending(
		left.lastUsedAt,
		right.lastUsedAt
	);
	if (recency !== 0) {
		return recency;
	}
	return left.profileName.localeCompare(right.profileName);
}

export function compareAddMembersPeople(
	left: SpaceAddMembersPersonGroup,
	right: SpaceAddMembersPersonGroup
): number {
	const activity = compareOptionalDatesDescending(
		left.lastActiveAt,
		right.lastActiveAt
	);
	return activity || left.name.localeCompare(right.name);
}

export function compareOptionalDatesDescending(
	left: string | null | undefined,
	right: string | null | undefined
): number {
	const leftTime = left ? Date.parse(left) : 0;
	const rightTime = right ? Date.parse(right) : 0;
	return rightTime - leftTime;
}

export function buildPersonalAddMemberGroups(input: {
	directory: OrganizationSpaceProfileCandidates | null;
	alreadyJoinedCandidates: readonly SpaceProfileAddCandidate[];
	selectableCandidates: readonly SpaceProfileAddCandidate[];
}): SpaceAddMembersCandidateGroups {
	const groupsByOwner = new Map<string, SpaceAddMembersPersonGroup>();
	for (const { alreadyMember, candidate } of [
		...input.alreadyJoinedCandidates.map((candidate) => ({
			alreadyMember: true,
			candidate,
		})),
		...input.selectableCandidates.map((candidate) => ({
			alreadyMember: false,
			candidate,
		})),
	]) {
		const summary = {
			...toAddMembersCandidateSummary(candidate),
			agentControllerRef:
				input.directory?.agentProfiles.find(
					(profile) => profile.profileId === candidate.profile.profileId
				)?.agentControllerRef ?? null,
			alreadyMember,
		};
		const ownerId = candidate.profile.ownerUserId ?? "personal";
		const ownerName = candidate.profile.ownerName?.trim() || "You";
		const current = groupsByOwner.get(ownerId) ?? {
			agentCandidates: [],
			humanAlreadyMember: false,
			humanCandidate: null,
			id: ownerId,
			lastActiveAt: null,
			name: ownerName,
			searchText: normalizeAddMembersSearchText([ownerName]),
		};
		if (summary.profileKind === "human") {
			current.humanAlreadyMember = alreadyMember;
			current.humanCandidate = alreadyMember ? null : summary;
			current.name = summary.profileName;
			current.searchText = normalizeAddMembersSearchText([
				summary.profileName,
				ownerName,
			]);
		} else {
			(current.agentCandidates as SpaceAddMembersCandidateSummary[]).push(
				summary
			);
		}
		groupsByOwner.set(ownerId, current);
	}
	return {
		alreadyJoinedCount: input.alreadyJoinedCandidates.length,
		organizationCandidates: [],
		personGroups: [...groupsByOwner.values()].map((group) => ({
			...group,
			agentCandidates: [...group.agentCandidates].sort(
				compareAddMembersCandidates
			),
		})),
	};
}

export function filterAddMemberGroups(
	groups: SpaceAddMembersCandidateGroups,
	query: string,
	selectedProfileIds?: ReadonlySet<string>
): SpaceAddMembersCandidateGroups {
	if (!query) {
		return groups;
	}
	return {
		...groups,
		organizationCandidates: groups.organizationCandidates.filter(
			(candidate) =>
				candidate.searchText.includes(query) ||
				selectedProfileIds?.has(candidate.profileId)
		),
		personGroups: groups.personGroups.flatMap((group) => {
			if (group.searchText.includes(query)) {
				return [group];
			}
			const agentCandidates = group.agentCandidates.filter(
				(candidate) =>
					candidate.searchText.includes(query) ||
					selectedProfileIds?.has(candidate.profileId)
			);
			return agentCandidates.length > 0 ? [{ ...group, agentCandidates }] : [];
		}),
	};
}

/**
 * With MemberAgents, another member's personal Agent is never added
 * directly: choosing it asks its owner (member-agent-program.md §4.6).
 */
export function isAgentRequestCandidate(
	candidate: SpaceAddMembersCandidateSummary,
	currentOwnerUserId: string | null | undefined
): boolean {
	return (
		candidate.profileKind === "agent" &&
		!candidate.isCenterAgent &&
		Boolean(candidate.ownerUserId) &&
		candidate.ownerUserId !== currentOwnerUserId
	);
}

export function resolveEffectiveAddMemberProfileIds(input: {
	candidateGroups: SpaceAddMembersCandidateGroups;
	selectedProfileIds: ReadonlySet<string>;
	/** Set when choosing another member's Agent asks instead of adding. */
	agentRequestsFor?: string | null;
}): ReadonlySet<string> {
	const effectiveIds = new Set(input.selectedProfileIds);
	for (const group of input.candidateGroups.personGroups) {
		if (
			group.humanCandidate &&
			group.agentCandidates.some(
				(agent) =>
					input.selectedProfileIds.has(agent.profileId) &&
					agent.ownerHumanProfileId === group.humanCandidate?.profileId &&
					!(
						input.agentRequestsFor !== undefined &&
						isAgentRequestCandidate(agent, input.agentRequestsFor)
					)
			)
		) {
			effectiveIds.add(group.humanCandidate.profileId);
		}
	}
	return effectiveIds;
}

export function resolvePersonActivityLabel(
	lastActiveAt: string | null
): string | undefined {
	return (
		resolveDirectoryHumanProfileActivityLabel({
			lastActiveAt,
			profileStatus: "active",
		}) ?? undefined
	);
}

export function resolveAgentCandidateDescription(
	candidate: SpaceAddMembersCandidateSummary
): string | undefined {
	if (candidate.alreadyMember) {
		return "In this Space";
	}
	if (candidate.description) {
		return candidate.description;
	}
	if (candidate.operationalStatus === "working") {
		return "Working now";
	}
	if (candidate.operationalStatus === "paused") {
		return "Paused";
	}
	return candidate.availabilityLabel ?? undefined;
}
