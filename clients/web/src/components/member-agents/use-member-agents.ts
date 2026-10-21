import type { MemberAgentDirectMessageSessionSummary } from "@openmeld/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import {
	hasPendingMemberAgentSetup,
	syncMemberAgents,
} from "#/lib/member-agents/sync-member-agents";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	agentDirectMessageSessionQueryKeys,
	memberAgentDirectMessageSessionsQueryOptions,
} from "#/query/organizations/agent-direct-message-sessions";
import {
	memberAgentQueryKeys,
	memberAgentsQueryOptions,
} from "#/query/organizations/member-agents";
import {
	organizationProfileIdentityDirectoryQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
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
		// A half set-up Agent is finished by another sync, for a while.
		refetchInterval: (query) =>
			hasPendingMemberAgentSetup(query.state.data?.response) &&
			query.state.dataUpdateCount < MEMBER_AGENT_SETUP_SYNC_ATTEMPTS
				? MEMBER_AGENT_SETUP_SYNC_INTERVAL_MS
				: false,
	});
	useEffect(() => {
		if (sync.data?.changed) {
			invalidateMemberAgentReads(queryClient, organizationId);
		}
	}, [sync.data, organizationId, queryClient]);
}

const MEMBER_AGENT_SETUP_SYNC_INTERVAL_MS = 10_000;
const MEMBER_AGENT_SETUP_SYNC_ATTEMPTS = 12;

/**
 * Rereads everything a MemberAgent row is built from, so a new MemberAgent
 * never shows without its Profiles: the listing, presence, the
 * Organization's Profile directory and runtime overview, the owner's
 * Profiles, and their Sessions. Never the sync query itself, which lives under the same prefix.
 */
export function invalidateMemberAgentReads(
	queryClient: ReturnType<typeof useQueryClient>,
	organizationId: string
): void {
	Promise.all([
		queryClient.invalidateQueries({
			queryKey: memberAgentQueryKeys.all(organizationId),
			exact: true,
		}),
		queryClient.invalidateQueries({
			queryKey: memberAgentQueryKeys.presence(organizationId),
		}),
		queryClient.invalidateQueries({
			queryKey: organizationQueryKeys.profileDirectory(organizationId),
		}),
		queryClient.invalidateQueries({
			queryKey: organizationQueryKeys.agentRuntimeOverview(organizationId),
		}),
		queryClient.invalidateQueries({ queryKey: startQueryKeys.allProfiles }),
		queryClient.invalidateQueries({
			queryKey: agentDirectMessageSessionQueryKeys.memberAgents(organizationId),
		}),
	]).catch(console.error);
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

/**
 * The member's Sessions with their own MemberAgents' Profiles, in one read
 * for every Profile (never one list per Profile).
 */
function useMemberAgentSessionSummaries(
	memberAgents: MemberAgentIndexState
): readonly MemberAgentDirectMessageSessionSummary[] {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	const query = useQuery(
		memberAgentDirectMessageSessionsQueryOptions({
			organizationId,
			enabled: memberAgents.ready && Boolean(organizationId),
		})
	);
	const byProfileId = memberAgents.index.byProfileId;
	return useMemo(
		() =>
			(query.data?.sessions ?? []).filter((session) =>
				byProfileId.has(session.agentProfileId)
			),
		[query.data, byProfileId]
	);
}

function useEnabledArchivedMemberAgentSessionIds(
	memberAgents: MemberAgentIndexState
): ReadonlySet<string> {
	const sessions = useMemberAgentSessionSummaries(memberAgents);
	const key = sessions
		.filter((session) => session.archivedAt !== null)
		.map((session) => session.spaceId)
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

function useEnabledMemberAgentSessionTitles(
	memberAgents: MemberAgentIndexState
): ReadonlyMap<string, string> {
	// Archived Sessions keep their title too.
	const sessions = useMemberAgentSessionSummaries(memberAgents);
	const key = JSON.stringify(
		sessions.map((session) => [session.spaceId, session.name ?? "New chat"])
	);
	// Stable across renders until a Session is added or renamed.
	return useMemo(() => new Map(JSON.parse(key) as [string, string][]), [key]);
}

const NO_SESSION_TITLES: ReadonlyMap<string, string> = new Map();

/**
 * Session titles of the member's MemberAgent Direct Messages, by Space
 * (the same names the chat header shows). Empty with the feature off.
 */
export const useMemberAgentSessionTitles: (
	memberAgents: MemberAgentIndexState
) => ReadonlyMap<string, string> = isMemberAgentsEnabled()
	? useEnabledMemberAgentSessionTitles
	: () => NO_SESSION_TITLES;
