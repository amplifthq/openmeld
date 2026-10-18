import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { syncMemberAgents } from "#/lib/member-agents/sync-member-agents";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { agentDirectMessageSessionsQueryOptions } from "#/query/organizations/agent-direct-message-sessions";
import {
	memberAgentQueryKeys,
	memberAgentsQueryOptions,
} from "#/query/organizations/member-agents";
import { organizationProfileIdentityDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import {
	buildMemberAgentIndex,
	EMPTY_MEMBER_AGENT_INDEX,
	type MemberAgentIndex,
} from "./member-agent-index";

export type MemberAgentIndexState = {
	enabled: boolean;
	ready: boolean;
	index: MemberAgentIndex;
	ownerName: string;
	/** The signed-in member's default Human Profile in this Organization. */
	humanProfileId: string | null;
};

const DISABLED_MEMBER_AGENT_INDEX: MemberAgentIndexState = {
	enabled: false,
	ready: false,
	index: EMPTY_MEMBER_AGENT_INDEX,
	ownerName: "",
	humanProfileId: null,
};

function useEnabledMemberAgentIndex(): MemberAgentIndexState {
	const appOrganization = useOptionalAppOrganization();
	const organization = appOrganization?.currentOrganization;
	const enabled = Boolean(organization);
	// The owner's display name is their default Human Profile name.
	const directory = useQuery(
		organizationProfileIdentityDirectoryQueryOptions({
			enabled,
			organizationId: organization?.id ?? "",
		})
	);
	const owner = directory.data?.members.find(
		(member) => member.userId === appOrganization?.currentUserId
	);
	const ownerName = owner?.humanProfile?.profileName ?? owner?.user.name ?? "";
	const query = useQuery(
		memberAgentsQueryOptions({
			organizationId: organization?.id ?? "",
			enabled,
		})
	);
	const index = useMemo(
		() =>
			query.data
				? buildMemberAgentIndex({ listing: query.data, ownerName })
				: EMPTY_MEMBER_AGENT_INDEX,
		[query.data, ownerName]
	);
	return {
		enabled,
		ready: enabled && query.isSuccess && ownerName.length > 0,
		index,
		ownerName,
		humanProfileId: owner?.humanProfile?.profileId ?? null,
	};
}

function useDisabledMemberAgentIndex(): MemberAgentIndexState {
	return DISABLED_MEMBER_AGENT_INDEX;
}

/**
 * The signed-in member's MemberAgents in the current Organization. The
 * implementation is chosen once from MEMBER_AGENTS_ENABLED: with the flag off
 * it reads nothing and every surface renders as before.
 */
export const useMemberAgentIndex: () => MemberAgentIndexState =
	isMemberAgentsEnabled()
		? useEnabledMemberAgentIndex
		: useDisabledMemberAgentIndex;

function useEnabledMemberAgentSync(): void {
	const organization = useOptionalAppOrganization()?.currentOrganization;
	const organizationId = organization?.id ?? "";
	const queryClient = useQueryClient();
	const sync = useQuery({
		queryKey: memberAgentQueryKeys.sync(organizationId),
		enabled: Boolean(organization),
		queryFn: ({ signal }) => syncMemberAgents({ organizationId, signal }),
		staleTime: 5 * 60_000,
		retry: false,
	});
	useEffect(() => {
		if (sync.data?.changed) {
			// Never the sync query itself, which lives under the same prefix.
			Promise.all([
				queryClient.invalidateQueries({
					queryKey: memberAgentQueryKeys.all(organizationId),
					exact: true,
				}),
				queryClient.invalidateQueries({
					queryKey: memberAgentQueryKeys.presence(organizationId),
				}),
			]).catch(console.error);
		}
	}, [sync.data, organizationId, queryClient]);
}

function useDisabledMemberAgentSync(): void {
	// MemberAgents are disabled; there is nothing to create.
}

/**
 * Runs Core's lazy MemberAgent creation when the member opens the Agents or
 * Direct Message surface of an Organization, then rereads the listing.
 */
export const useMemberAgentSync: () => void = isMemberAgentsEnabled()
	? useEnabledMemberAgentSync
	: useDisabledMemberAgentSync;

function useEnabledArchivedMemberAgentSessionIds(
	memberAgents: MemberAgentIndexState
): ReadonlySet<string> {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	const profileIds = [...memberAgents.index.byProfileId.keys()];
	const archived = useQueries({
		queries: profileIds.map((agentProfileId) =>
			agentDirectMessageSessionsQueryOptions({
				organizationId,
				agentProfileId,
				archived: true,
				enabled: memberAgents.ready && Boolean(organizationId),
			})
		),
	});
	const key = archived
		.flatMap(
			(query) => query.data?.sessions.map((session) => session.spaceId) ?? []
		)
		.join("\n");
	// Stable across renders until the archived Sessions change.
	return useMemo(() => new Set(key ? key.split("\n") : []), [key]);
}

const NO_ARCHIVED_SESSIONS: ReadonlySet<string> = new Set();

/** Archived Session Spaces of the member's MemberAgents (owner-only read). */
export const useArchivedMemberAgentSessionIds: (
	memberAgents: MemberAgentIndexState
) => ReadonlySet<string> = isMemberAgentsEnabled()
	? useEnabledArchivedMemberAgentSessionIds
	: () => NO_ARCHIVED_SESSIONS;
