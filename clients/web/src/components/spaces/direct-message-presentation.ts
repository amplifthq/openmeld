import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";

type DirectMessagePeer = {
	agentControllerRef: string | null;
	avatarStyle?: OrganizationProfileDirectoryResponse["agentProfiles"][number]["avatarStyle"];
	avatarModelId?: string | null;
	avatarUrl: string | null;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
};

export function resolveDirectMessagePresentation(input: {
	item: AccountSpaceItem;
	profileDirectory: OrganizationProfileDirectoryResponse | undefined;
	viewerProfileId: string;
}) {
	const profileIds = input.item.directMessageProfileIds;
	const participants = profileIds?.map((id) =>
		resolveProfile(id, input.profileDirectory)
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
			peer?.profileName ??
			(participants?.length === 2 && participants.every(Boolean)
				? participants.map((profile) => profile?.profileName).join(" and ")
				: input.item.spaceName),
		profileKind:
			peer?.profileKind ??
			(participants?.some((profile) => profile?.profileKind === "agent")
				? "agent"
				: "unknown"),
	};
}

function resolveProfile(
	profileId: string,
	profileDirectory: OrganizationProfileDirectoryResponse | undefined
): DirectMessagePeer | null {
	const agent = profileDirectory?.agentProfiles.find(
		(profile) => profile.profileId === profileId && profile.status === "active"
	);
	if (agent) {
		return {
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
	};
}
