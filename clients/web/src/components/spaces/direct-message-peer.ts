import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";

type DirectMessagePeer = {
	agentControllerRef: string | null;
	avatarUrl: string | null;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
};

export function resolveDirectMessagePeer(input: {
	item: AccountSpaceItem;
	profileDirectory: OrganizationProfileDirectoryResponse | undefined;
	viewerProfileId: string;
}): DirectMessagePeer | null {
	const profileIds = input.item.directMessageProfileIds;
	if (!profileIds?.includes(input.viewerProfileId)) {
		return null;
	}
	const profileId = profileIds.find(
		(candidate) => candidate !== input.viewerProfileId
	);
	if (!profileId) {
		return null;
	}
	const agent = input.profileDirectory?.agentProfiles.find(
		(profile) => profile.profileId === profileId && profile.status === "active"
	);
	if (agent) {
		return {
			agentControllerRef: agent.agentControllerRef,
			avatarUrl: agent.avatarUrl ?? null,
			profileId,
			profileKind: "agent",
			profileName: agent.profileName,
		};
	}
	const member = input.profileDirectory?.members.find(
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
