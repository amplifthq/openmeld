import type { AgentProfileAccessGrantView } from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useColleagueAccessState } from "#/lib/agents/colleague-access-state";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	agentProfileAccessGrantsQueryOptions,
	useAgentAccessRequests,
	useAlwaysAllowAgentAccess,
	useDecideAgentAccessRequest,
	useRequestAgentForSpace,
	useRevokeAgentAccessGrants,
	useWithdrawAgentAccessRequest,
} from "#/query/agent-access";
import { agentDirectMessageSessionsQueryOptions } from "#/query/organizations/agent-direct-message-sessions";
import { organizationProfileIdentityDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	type AgentAccessEntry,
	type AgentAccessEntrySpace,
	buildInSpaceAgentAccessEntries,
	buildOwnerAgentAccessEntries,
	buildRequesterAgentAccessEntry,
	buildRequesterSpaceJoinEntries,
	sortAgentAccessEntries,
} from "./agent-access-entries";
import type { AgentAccessListActions } from "./agent-access-list";

const EMPTY_GRANTS: readonly AgentProfileAccessGrantView[] = [];

export type AgentAccessEntriesState = {
	entries: AgentAccessEntry[];
	/** Names of the viewer's Spaces, for links to them. */
	spaceNames: ReadonlyMap<string, string>;
	actions: AgentAccessListActions;
	/** Human Profile → avatar image. */
	avatars: ReadonlyMap<string, string | null>;
	error: string | null;
	isPending: boolean;
};

function useOrganizationPeople() {
	const organization = useOptionalAppOrganization();
	const organizationId = organization?.currentOrganization.id ?? "";
	const directory = useQuery(
		organizationProfileIdentityDirectoryQueryOptions({
			enabled: Boolean(organizationId),
			organizationId,
		})
	);
	return useMemo(() => {
		const humanProfileIdByUserId = new Map<string, string>();
		const avatars = new Map<string, string | null>();
		const viewerUserId = organization?.currentUserId ?? null;
		let viewer: { profileId: string; userId: string; name: string } | null =
			null;
		for (const member of directory.data?.members ?? []) {
			const profileId = member.humanProfile?.profileId;
			if (!profileId) {
				continue;
			}
			humanProfileIdByUserId.set(member.userId, profileId);
			avatars.set(profileId, member.user.image ?? null);
			if (member.userId === viewerUserId) {
				viewer = {
					profileId,
					userId: member.userId,
					name: member.humanProfile?.profileName ?? member.user.name,
				};
			}
		}
		return {
			organizationId,
			viewerUserId,
			viewer,
			humanProfileIdByUserId,
			avatars,
		};
	}, [directory.data, organization?.currentUserId, organizationId]);
}

/** The owner's grants for each of their Agents in view. */
function useOwnerGrants(input: {
	organizationId: string;
	profileIds: readonly string[];
}): readonly AgentProfileAccessGrantView[] {
	return useQueries({
		queries: input.profileIds.map((profileId) =>
			agentProfileAccessGrantsQueryOptions({
				organizationId: input.organizationId,
				profileId,
			})
		),
		combine: (results) =>
			results.flatMap((result) => result.data ?? EMPTY_GRANTS),
	});
}

function useAgentAccessActions(input: {
	askAgain?: (entry: AgentAccessEntry) => void;
}) {
	const decide = useDecideAgentAccessRequest();
	const withdraw = useWithdrawAgentAccessRequest();
	const revoke = useRevokeAgentAccessGrants();
	const alwaysAllow = useAlwaysAllowAgentAccess();
	const resetAll = () => {
		decide.reset();
		withdraw.reset();
		revoke.reset();
		alwaysAllow.reset();
	};
	const actions: AgentAccessListActions = {
		busy:
			decide.isPending ||
			withdraw.isPending ||
			revoke.isPending ||
			alwaysAllow.isPending,
		decide: (request, decision) => {
			resetAll();
			decide.mutate({ requestId: request.id, decision });
		},
		withdraw: (request) => {
			resetAll();
			withdraw.mutate(request.id);
		},
		alwaysAllow: (entry) => {
			if (!entry.person?.userId) {
				return;
			}
			resetAll();
			alwaysAllow.mutate({
				profileId: entry.agent.profileId,
				granteeUserId: entry.person.userId,
			});
		},
		removeAccess: (entry) => {
			resetAll();
			revoke.mutate(entry.grants);
		},
		askAgain: input.askAgain,
	};
	return {
		actions,
		error:
			decide.error?.message ??
			withdraw.error?.message ??
			revoke.error?.message ??
			alwaysAllow.error?.message ??
			null,
	};
}

/**
 * The access entries one Space concerns. In a Direct Message: the
 * requester's entry for its Agent. In a group Space: other people's Agents
 * in it, and requests to add one.
 */
export function useSpaceAgentAccessEntries(input: {
	spaceId: string | undefined;
	isDirectMessage: boolean;
	snapshot: SpaceMembersSnapshot | null;
	centerAgentProfileId: string | null;
	/** The Direct Message's composer is the way to ask again. */
	onAskAgainInDirectMessage?: () => void;
}): AgentAccessEntriesState {
	const people = useOrganizationPeople();
	const spaceId = input.spaceId ?? "";
	const requests = useAgentAccessRequests(
		{ spaceId },
		{ enabled: Boolean(spaceId) }
	);
	const ownedProfileIds = useMemo(
		() => [
			...new Set(
				(requests.data ?? [])
					.filter((request) => request.viewerRole === "owner")
					.map((request) => request.agentProfileId)
			),
		],
		[requests.data]
	);
	const grants = useOwnerGrants({
		organizationId: people.organizationId,
		profileIds: input.isDirectMessage ? ownedProfileIds : [],
	});
	// The teammate's Agent in a Direct Message the viewer does not own.
	const colleagueAgent = input.isDirectMessage
		? (input.snapshot?.agents.find(
				(agent) =>
					agent.status === "active" &&
					agent.profileId !== input.centerAgentProfileId &&
					Boolean(agent.ownerUserId) &&
					agent.ownerUserId !== people.viewerUserId
			) ?? null)
		: null;
	const colleagueAccess = useColleagueAccessState({
		ownerUserId: colleagueAgent?.ownerUserId,
		profileId: colleagueAgent?.profileId,
		spaceId,
	});
	const requestForSpace = useRequestAgentForSpace();
	const { actions, error } = useAgentAccessActions({
		askAgain: (entry) => {
			if (input.isDirectMessage) {
				input.onAskAgainInDirectMessage?.();
				return;
			}
			requestForSpace.mutate({
				spaceId,
				agentProfileId: entry.agent.profileId,
			});
		},
	});
	const entries = useMemo(() => {
		if (!(spaceId && people.viewerUserId)) {
			return [];
		}
		const owner = buildOwnerAgentAccessEntries({
			requests: requests.data ?? [],
			grants,
			agents: new Map(),
			ownerUserId: people.viewerUserId,
			humanProfileIdByUserId: people.humanProfileIdByUserId,
		});
		if (input.isDirectMessage) {
			const requester =
				colleagueAgent?.ownerUserId && colleagueAccess && people.viewer
					? buildRequesterAgentAccessEntry({
							access: colleagueAccess,
							agent: {
								profileId: colleagueAgent.profileId,
								name: colleagueAgent.profileName,
								ownerUserId: colleagueAgent.ownerUserId,
							},
							viewer: people.viewer,
							spaces: [{ spaceId, kind: "direct_message" }],
						})
					: null;
			return sortAgentAccessEntries(requester ? [...owner, requester] : owner);
		}
		return sortAgentAccessEntries([
			...owner.filter((entry) => entry.rule === "waiting"),
			...buildRequesterSpaceJoinEntries({
				requests: requests.data ?? [],
				spaceId,
			}),
			...buildInSpaceAgentAccessEntries({
				spaceId,
				viewerUserId: people.viewerUserId,
				centerAgentProfileId: input.centerAgentProfileId,
				agents: input.snapshot?.agents ?? [],
			}),
		]);
	}, [
		colleagueAccess,
		colleagueAgent,
		grants,
		input.centerAgentProfileId,
		input.isDirectMessage,
		input.snapshot?.agents,
		people,
		requests.data,
		spaceId,
	]);
	return {
		entries,
		actions: {
			...actions,
			busy: actions.busy || requestForSpace.isPending,
		},
		avatars: people.avatars,
		spaceNames: new Map(),
		error: error ?? requestForSpace.error?.message ?? null,
		isPending: requests.isPending,
	};
}

/**
 * The Agent page's access rows, read-only there. The owner sees one row per
 * person with every request and grant; a teammate sees only their own
 * access, with their chats with the Agent as its Spaces.
 */
export function useAgentProfileAccessEntries(input: {
	profileId: string;
	profileName: string;
	ownerUserId: string | null | undefined;
	isOwner: boolean;
}): Pick<
	AgentAccessEntriesState,
	"avatars" | "entries" | "isPending" | "spaceNames"
> {
	const people = useOrganizationPeople();
	const spaces = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: Boolean(people.viewer),
			profileId: people.viewer?.profileId ?? "",
		})
	);
	const requests = useAgentAccessRequests(
		{ role: "owner" },
		{ enabled: input.isOwner }
	);
	const grants = useOwnerGrants({
		organizationId: people.organizationId,
		profileIds: input.isOwner ? [input.profileId] : [],
	});
	const colleagueAccess = useColleagueAccessState({
		ownerUserId: input.isOwner ? null : input.ownerUserId,
		profileId: input.profileId,
	});
	const sessions = useQuery(
		agentDirectMessageSessionsQueryOptions({
			organizationId: people.organizationId,
			agentProfileId: input.profileId,
			enabled:
				!input.isOwner && Boolean(people.organizationId && input.ownerUserId),
		})
	);
	const viewerChats = useMemo<AgentAccessEntrySpace[]>(
		() =>
			(sessions.data?.sessions ?? [])
				.filter((session) => !session.archivedAt)
				.map((session) => ({
					spaceId: session.spaceId,
					kind: "direct_message",
				})),
		[sessions.data]
	);
	const entries = useMemo(() => {
		if (input.isOwner) {
			if (!people.viewerUserId) {
				return [];
			}
			return sortAgentAccessEntries(
				buildOwnerAgentAccessEntries({
					requests: (requests.data ?? []).filter(
						(request) => request.agentProfileId === input.profileId
					),
					grants,
					agents: new Map([
						[input.profileId, { name: input.profileName, ownerName: null }],
					]),
					ownerUserId: people.viewerUserId,
					humanProfileIdByUserId: people.humanProfileIdByUserId,
				})
			);
		}
		if (!(colleagueAccess && people.viewer && input.ownerUserId)) {
			return [];
		}
		const entry = buildRequesterAgentAccessEntry({
			access: colleagueAccess,
			agent: {
				profileId: input.profileId,
				name: input.profileName,
				ownerUserId: input.ownerUserId,
			},
			viewer: people.viewer,
			spaces: viewerChats,
		});
		return entry ? [entry] : [];
	}, [
		colleagueAccess,
		grants,
		input.isOwner,
		input.ownerUserId,
		input.profileId,
		input.profileName,
		people,
		requests.data,
		viewerChats,
	]);
	const spaceNames = useMemo(
		() =>
			new Map(
				[
					...(spaces.data?.pinnedItems ?? []),
					...(spaces.data?.spaceItems ?? []),
				].map((item) => [item.spaceId, item.spaceName])
			),
		[spaces.data]
	);
	return {
		entries,
		avatars: people.avatars,
		isPending: input.isOwner ? requests.isPending : colleagueAccess === null,
		spaceNames,
	};
}
