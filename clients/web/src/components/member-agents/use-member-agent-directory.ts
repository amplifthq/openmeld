import type {
	AuthProfileView,
	OrganizationAgentRuntimeOverviewResponse,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
	invalidateMemberAgentReads,
	useArchivedMemberAgentSessionIds,
	useMemberAgentIndex,
} from "./use-member-agents";

const MEMBER_AGENT_SETUP_REFRESH_INTERVAL_MS = 3000;
const MEMBER_AGENT_SETUP_REFRESH_ATTEMPTS = 20;

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
	const directory = useMemo(() => {
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
	const refreshExhausted = useMemberAgentSetupRefresh({
		creating: directory?.rows.some((row) => row.setup === "creating") ?? false,
		organizationId: currentOrganization.id,
	});
	return useMemo(
		() =>
			directory && refreshExhausted
				? {
						...directory,
						// Setup did not settle: show what is readable, never a
						// "Setting up" badge forever.
						rows: directory.rows.map((row) =>
							row.setup === "creating"
								? { ...row, setup: "ready" as const }
								: row
						),
					}
				: directory,
		[directory, refreshExhausted]
	);
}

/**
 * While a row is still being set up, reread its sources briefly so it
 * settles on its own instead of waiting for the next page visit.
 */
function useMemberAgentSetupRefresh(input: {
	creating: boolean;
	organizationId: string;
}): boolean {
	const queryClient = useQueryClient();
	const [exhausted, setExhausted] = useState(false);
	useEffect(() => {
		if (!input.creating) {
			setExhausted(false);
			return;
		}
		let attempts = 0;
		const timer = setInterval(() => {
			attempts += 1;
			invalidateMemberAgentReads(queryClient, input.organizationId);
			if (attempts >= MEMBER_AGENT_SETUP_REFRESH_ATTEMPTS) {
				clearInterval(timer);
				setExhausted(true);
			}
		}, MEMBER_AGENT_SETUP_REFRESH_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [input.creating, input.organizationId, queryClient]);
	return exhausted;
}
