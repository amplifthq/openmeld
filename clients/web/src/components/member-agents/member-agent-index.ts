import type {
	HarnessKind,
	ListMemberAgentsResponse,
	MemberAgentWithProfiles,
} from "@openmeld/schemas";
import {
	formatMemberAgentDisplayName,
	formatMemberAgentProfileDisplayName,
} from "./member-agent-display-name";

export type IndexedMemberAgent = {
	memberAgent: MemberAgentWithProfiles;
	harnessKind: HarnessKind;
	displayName: string;
};

export type MemberAgentProfileEntry = {
	memberAgentId: string;
	memberAgentName: string;
	harnessKind: HarnessKind;
	profileName: string;
	isDefaultProfile: boolean;
	/** `Felix Lu’s Claude Code` or `Felix Lu’s Claude Code · PR Reviewer`. */
	profileDisplayName: string;
};

export type MemberAgentIndex = {
	memberAgents: readonly IndexedMemberAgent[];
	byId: ReadonlyMap<string, IndexedMemberAgent>;
	byProfileId: ReadonlyMap<string, MemberAgentProfileEntry>;
	unassignedProfileIds: ReadonlySet<string>;
};

export const EMPTY_MEMBER_AGENT_INDEX: MemberAgentIndex = {
	memberAgents: [],
	byId: new Map(),
	byProfileId: new Map(),
	unassignedProfileIds: new Set(),
};

/** Indexes the owner's MemberAgent listing; display names are derived here. */
export function buildMemberAgentIndex(input: {
	listing: ListMemberAgentsResponse;
	ownerName: string;
}): MemberAgentIndex {
	const memberAgents: IndexedMemberAgent[] = [];
	const byProfileId = new Map<string, MemberAgentProfileEntry>();
	for (const memberAgent of input.listing.memberAgents) {
		const displayName = formatMemberAgentDisplayName({
			ownerName: input.ownerName,
			harnessKind: memberAgent.harnessKind,
		});
		memberAgents.push({
			memberAgent,
			harnessKind: memberAgent.harnessKind,
			displayName,
		});
		for (const profile of memberAgent.profiles) {
			const isDefaultProfile =
				profile.isDefault ||
				memberAgent.defaultProfileId === profile.openMeldProfileId;
			byProfileId.set(profile.openMeldProfileId, {
				memberAgentId: memberAgent.id,
				memberAgentName: displayName,
				harnessKind: memberAgent.harnessKind,
				profileName: profile.profileName,
				isDefaultProfile,
				profileDisplayName: formatMemberAgentProfileDisplayName({
					memberAgentName: displayName,
					profileName: profile.profileName,
					isDefaultProfile,
				}),
			});
		}
	}
	return {
		memberAgents,
		byId: new Map(memberAgents.map((entry) => [entry.memberAgent.id, entry])),
		byProfileId,
		unassignedProfileIds: new Set(
			input.listing.unassignedProfiles.map(
				(profile) => profile.openMeldProfileId
			)
		),
	};
}
