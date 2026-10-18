import type {
	AuthProfileView,
	OrganizationAgentRuntimeOverviewResponse,
} from "@openmeld/schemas/types";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { selectAccountSpaceSections } from "#/components/spaces/account-space-sections";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { memberAgentPresenceQueryOptions } from "#/query/organizations/member-agents";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	buildMemberAgentDirectory,
	type MemberAgentDirectory,
} from "./member-agent-directory-model";
import {
	useArchivedMemberAgentSessionIds,
	useMemberAgentIndex,
} from "./use-member-agents";

type RuntimeOverviewItem =
	OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number];

type MemberAgentDirectoryInput = {
	profiles: readonly AuthProfileView[];
	runtimeByProfileId: ReadonlyMap<string, RuntimeOverviewItem>;
};

/**
 * The signed-in member's Agents grouped by MemberAgent, or null while the
 * flag is off or the listing is not readable. Callers then keep the per-Profile
 * list, so a failed or pending read never hides a Profile.
 */
export const useMemberAgentDirectory: (
	input: MemberAgentDirectoryInput
) => MemberAgentDirectory | null = isMemberAgentsEnabled()
	? useEnabledMemberAgentDirectory
	: () => null;

function useEnabledMemberAgentDirectory(input: {
	profiles: readonly AuthProfileView[];
	runtimeByProfileId: ReadonlyMap<string, RuntimeOverviewItem>;
}): MemberAgentDirectory | null {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const memberAgents = useMemberAgentIndex();
	const humanProfileId = memberAgents.humanProfileId ?? "";
	const archivedSpaceIds = useArchivedMemberAgentSessionIds(memberAgents);
	const presence = useQuery(
		memberAgentPresenceQueryOptions({
			organizationId: currentOrganization.id,
			enabled: memberAgents.ready,
		})
	);
	const spaces = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: memberAgents.enabled && Boolean(humanProfileId),
			profileId: humanProfileId,
			scope: "account",
		})
	);
	return useMemo(() => {
		if (!memberAgents.ready) {
			return null;
		}
		return buildMemberAgentDirectory({
			index: memberAgents.index,
			ownedProfiles: input.profiles.filter(
				(profile) => profile.ownerUserId === currentUserId
			),
			runtimeByProfileId: input.runtimeByProfileId,
			archivedSpaceIds,
			presenceByMemberAgentId: new Map(
				(presence.data?.memberAgents ?? []).map((item) => [
					item.memberAgentId,
					item,
				])
			),
			directMessages: spaces.data
				? selectAccountSpaceSections({
						currentOrganizationId: currentOrganization.id,
						sections: spaces.data,
					}).directMessageItems
				: [],
		});
	}, [
		memberAgents.ready,
		memberAgents.index,
		input.profiles,
		input.runtimeByProfileId,
		currentUserId,
		currentOrganization.id,
		spaces.data,
		presence.data,
		archivedSpaceIds,
	]);
}
