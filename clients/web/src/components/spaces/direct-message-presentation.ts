import type {
	OrganizationProfileDirectoryResponse,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { formatAgentProfileOwnerHarnessName } from "#/components/member-agents/member-agent-display-name";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";

type DirectMessagePeer = {
	agentControllerRef: string | null;
	avatarStyle?: OrganizationProfileDirectoryResponse["agentProfiles"][number]["avatarStyle"];
	avatarModelId?: string | null;
	avatarUrl: string | null;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
	/** The Profile's name as a conversation title; see resolveAgentDisplayName. */
	displayName: string;
	/** The owning member of an agent Profile, when it is not the viewer. */
	ownerUserId?: string;
	/** A human Profile's member. */
	userId?: string;
};

/** Session controls belong to the Human in the pair, regardless of Agent ownership. */
export function resolveDirectMessageSessionAgentProfileId(input: {
	isDirectMessage: boolean;
	isCenterAgentDirectMessage: boolean;
	viewerProfileId: string;
	snapshot: SpaceMembersSnapshot | null;
}): string | null {
	if (
		!(isMemberAgentsEnabled() && input.isDirectMessage) ||
		input.isCenterAgentDirectMessage ||
		!input.snapshot
	) {
		return null;
	}
	const humans = input.snapshot.humans.filter(
		(member) => member.status === "active"
	);
	const agents = input.snapshot.agents.filter(
		(member) => member.status === "active"
	);
	return humans.length === 1 &&
		humans[0]?.profileId === input.viewerProfileId &&
		agents.length === 1
		? (agents[0]?.profileId ?? null)
		: null;
}

export function resolveDirectMessagePresentation(input: {
	item: AccountSpaceItem;
	profileDirectory: OrganizationProfileDirectoryResponse | undefined;
	viewerProfileId: string;
	/** The signed-in user, so another member's Agent is named with its owner. */
	viewerUserId?: string | null;
}) {
	const profileIds = input.item.directMessageProfileIds;
	const participants = profileIds?.map((id) =>
		resolveProfile(id, input.profileDirectory, input.viewerUserId ?? null)
	);
	const peer = profileIds?.includes(input.viewerProfileId)
		? (participants?.find(
				(profile) => profile && profile.profileId !== input.viewerProfileId
			) ?? null)
		: null;
	return {
		peer,
		participants:
			participants?.filter(
				(profile): profile is DirectMessagePeer => profile !== null
			) ?? [],
		name:
			peer?.displayName ??
			(participants?.length === 2 && participants.every(Boolean)
				? participants
						.map((profile, index) => pairName(profile, participants[1 - index]))
						.join(" and ")
				: input.item.spaceName),
		profileKind:
			peer?.profileKind ??
			(participants?.some((profile) => profile?.profileKind === "agent")
				? "agent"
				: "unknown"),
	};
}

/** In "A and B", an Agent next to its own owner needs no possessive. */
function pairName(
	profile: DirectMessagePeer | null,
	other: DirectMessagePeer | null | undefined
): string | undefined {
	return profile?.ownerUserId && other?.userId === profile.ownerUserId
		? profile.profileName
		: profile?.displayName;
}

/**
 * With MemberAgents on, an Agent another member owns is titled with its
 * owner, `Tali Smoke’s Claude Code`, so it is not mistaken for the viewer's
 * own Agent of the same harness. The viewer's own Agents and org-owned
 * Agents keep their Profile name; profileName stays the stored name.
 */
function resolveAgentDisplayName(input: {
	agent: OrganizationProfileDirectoryResponse["agentProfiles"][number];
	profileDirectory: OrganizationProfileDirectoryResponse;
	viewerUserId: string | null;
}): { displayName: string; ownerUserId?: string } {
	const { agent } = input;
	if (
		!(isMemberAgentsEnabled() && input.viewerUserId && agent.ownerUserId) ||
		agent.ownerUserId === input.viewerUserId
	) {
		return { displayName: agent.profileName };
	}
	// Owners are named by their default Human Profile, like MemberAgents.
	const owner = input.profileDirectory.members.find(
		(member) => member.userId === agent.ownerUserId
	);
	const ownerName =
		owner?.humanProfile?.profileName ?? owner?.user.name ?? agent.ownerName;
	if (!ownerName) {
		return { displayName: agent.profileName };
	}
	return {
		displayName:
			formatAgentProfileOwnerHarnessName({
				agentControllerRef: agent.agentControllerRef,
				ownerName,
				profileName: agent.profileName,
			}) ?? `${ownerName}’s ${agent.profileName}`,
		ownerUserId: agent.ownerUserId,
	};
}

function resolveProfile(
	profileId: string,
	profileDirectory: OrganizationProfileDirectoryResponse | undefined,
	viewerUserId: string | null
): DirectMessagePeer | null {
	const agent = profileDirectory?.agentProfiles.find(
		(profile) => profile.profileId === profileId && profile.status === "active"
	);
	if (agent && profileDirectory) {
		return {
			...resolveAgentDisplayName({ agent, profileDirectory, viewerUserId }),
			agentControllerRef: agent.agentControllerRef,
			avatarStyle: agent.avatarStyle,
			avatarModelId: agent.avatarModelId,
			avatarUrl: agent.avatarUrl ?? null,
			profileId,
			profileKind: "agent",
			profileName: agent.profileName,
		};
	}
	const member = profileDirectory?.members.find(
		(candidate) =>
			candidate.humanProfile?.profileId === profileId &&
			candidate.humanProfile.status === "active"
	);
	if (!member?.humanProfile) {
		return null;
	}
	return {
		agentControllerRef: null,
		avatarUrl: member.user.image,
		profileId,
		profileKind: "human",
		profileName: member.humanProfile.profileName,
		displayName: member.humanProfile.profileName,
		userId: member.userId,
	};
}
