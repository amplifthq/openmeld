import type { InboxItem } from "@openmeld/schemas/types";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { CenterAgentChatAvatar } from "#/components/organizations/center-agent-chat-avatar";
import {
	isDirectMessageItem,
	resolveAccountSpaceViewerProfileId,
} from "#/components/spaces/account-space-sections";
import { resolveDirectMessagePeer } from "#/components/spaces/direct-message-peer";
import {
	resolveSpaceMemberAppearances,
	SpaceMemberAvatars,
} from "#/components/spaces/space-member-avatars";
import { SpaceProfileIcon } from "#/components/spaces/space-profile-icon";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { centerAgentSessionsQueryOptions } from "#/query/organizations/center-agent-sessions";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";

const InboxAvatars = createContext<ReadonlyMap<string, ReactNode>>(new Map());

function directMessageAvatar(
	peer: ReturnType<typeof resolveDirectMessagePeer>
) {
	return peer ? (
		<SpaceProfileIcon
			agentControllerRef={peer.agentControllerRef}
			avatarImageUrl={peer.avatarUrl}
			avatarModelId={peer.avatarModelId}
			avatarStyle={peer.avatarStyle}
			profileId={peer.profileId}
			profileKind={peer.profileKind}
			profileName={peer.profileName}
			size="sm"
		/>
	) : null;
}

/** Share the sidebar's authorized Space index and Profile presentation, not Inbox copies. */
export function InboxAvatarProvider({ children }: { children: ReactNode }) {
	const { currentOrganization } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId ?? "";
	const sessions = useInfiniteQuery(
		centerAgentSessionsQueryOptions(currentOrganization.id, profileId)
	);
	const spaces = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: !!profileId,
			profileId,
			scope: "account",
		})
	);
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: !!profileId,
			organizationId: currentOrganization.id,
		})
	);
	const avatars = useMemo(() => {
		const result = new Map<string, ReactNode>();
		const appearances = resolveSpaceMemberAppearances(directory.data);
		for (const item of [
			...(spaces.data?.pinnedItems ?? []),
			...(spaces.data?.spaceItems ?? []),
		]) {
			if (item.organizationId !== currentOrganization.id) {
				continue;
			}
			if (isDirectMessageItem(item)) {
				const peer = resolveDirectMessagePeer({
					item,
					profileDirectory: directory.data,
					viewerProfileId: resolveAccountSpaceViewerProfileId({
						currentProfileId: profileId,
						item,
					}),
				});
				result.set(item.spaceId, directMessageAvatar(peer));
			} else if (item.memberPreviews?.length) {
				result.set(
					item.spaceId,
					<SpaceMemberAvatars
						appearances={appearances}
						members={item.memberPreviews}
					/>
				);
			}
		}
		for (const session of sessions.data?.pages.flatMap(
			(page) => page.sessions
		) ?? []) {
			const profile = directory.data?.agentProfiles.find(
				(candidate) => candidate.profileId === session.centerAgentProfileId
			);
			if (profile) {
				result.set(
					session.spaceId,
					<CenterAgentChatAvatar
						avatarStyle={profile.avatarStyle}
						profileId={profile.profileId}
						profileName={profile.profileName}
					/>
				);
			}
		}
		return result;
	}, [
		spaces.data,
		sessions.data,
		directory.data,
		profileId,
		currentOrganization.id,
	]);
	return <InboxAvatars value={avatars}>{children}</InboxAvatars>;
}

export function useInboxAvatar(item: InboxItem): ReactNode {
	const avatars = useContext(InboxAvatars);
	const target = item.sourceTarget;
	return "spaceId" in target && target.spaceId
		? avatars.get(target.spaceId)
		: undefined;
}
