import { createDirectMessageApi } from "@openmeld/api-client";
import {
	AGENT_DIRECT_MESSAGE_SESSION_NAME_MAX_LENGTH,
	type HarnessKind,
} from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ChatTitleEditor } from "#/components/organizations/chat-title-editor";
import { ChatHistoryDropdown } from "#/components/spaces/chat-history-dropdown";
import { SpaceStatusIndicator } from "#/components/spaces/space-status-indicator";
import {
	hasSpaceStatus,
	resolveSpaceStatusIndicators,
	resolveSpaceStatusLabel,
} from "#/components/spaces/space-status-indicators";
import { useSavedConversationTitle } from "#/components/spaces/use-saved-conversation-title";
import { useSpaceStatusSources } from "#/components/spaces/use-space-status-sources";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationDirectMessagePath,
	buildOrganizationDirectMessagesPath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { agentDirectMessageSessionsQueryOptions } from "#/query/organizations/agent-direct-message-sessions";
import { useDirectMessageSessionActions } from "./direct-message-session-actions";
import { formatMemberAgentProfileDisplayName } from "./member-agent-display-name";
import type {
	IndexedMemberAgent,
	MemberAgentIndex,
} from "./member-agent-index";
import {
	rememberMemberAgentChat,
	useMemberAgentLastChatScope,
} from "./member-agent-last-chat";
import {
	useArchivedMemberAgentSessionIds,
	useMemberAgentIndex,
} from "./use-member-agents";

export type DirectMessageMemberAgent = {
	memberAgent: IndexedMemberAgent;
	agentProfileId: string;
};

/**
 * The MemberAgent of the signed-in member's current Direct Message Session:
 * one active Human (the viewer) and one active agent Profile of one of the
 * viewer's MemberAgents. Null everywhere else.
 */
export function resolveDirectMessageMemberAgent(input: {
	isDirectMessage: boolean;
	isCenterAgentDirectMessage: boolean;
	snapshot: SpaceMembersSnapshot | null;
	index: MemberAgentIndex;
}): DirectMessageMemberAgent | null {
	if (
		!input.isDirectMessage ||
		input.isCenterAgentDirectMessage ||
		!input.snapshot
	) {
		return null;
	}
	const agents = input.snapshot.agents.filter(
		(agent) => agent.status === "active"
	);
	if (agents.length !== 1 || !agents[0]) {
		return null;
	}
	const entry = input.index.byProfileId.get(agents[0].profileId);
	const memberAgent = entry ? input.index.byId.get(entry.memberAgentId) : null;
	return memberAgent
		? { memberAgent, agentProfileId: agents[0].profileId }
		: null;
}

/**
 * Chat title of a MemberAgent Direct Message: the shared chat-history
 * dropdown with its Sessions grouped by Profile and New chat, the existing
 * chat-title editor for Session rename, and Delete chat. Archive lives in
 * the existing chat menu (useMemberAgentSessionArchive).
 */
export function MemberAgentChatHistory(input: {
	spaceId: string;
	/** The viewer's Profile, which scopes the saved title. */
	profileId: string;
	title: string;
	current: DirectMessageMemberAgent;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const navigate = useNavigate();
	// Every Session is read, not only the open Profile's, so the title shows
	// when another Session needs the member.
	const sessions = useMemberAgentSessionGroups({
		memberAgent: input.current.memberAgent,
		currentProfileId: input.current.agentProfileId,
		spaceId: input.spaceId,
		includeAll: true,
	});
	const sessionIds = sessions.groups.flatMap((group) =>
		group.items.map((item) => item.spaceId)
	);
	const statusSources = useSpaceStatusSources({
		currentSpaceId: input.spaceId,
		spaceIds: sessionIds,
	});
	const titleStatus = resolveSpaceStatusIndicators(sessionIds, statusSources);
	const titleStatusLabel = resolveSpaceStatusLabel(titleStatus);
	const title =
		useSavedConversationTitle({
			known: sessions.currentTitle,
			profileId: input.profileId,
			spaceId: input.spaceId,
		}) ?? input.title;
	// Any way in counts, a direct link included: the Agent's entries reopen it.
	const lastChatScope = useMemberAgentLastChatScope();
	const organizationId = lastChatScope?.organizationId;
	const humanProfileId = lastChatScope?.humanProfileId;
	const memberAgentId = input.current.memberAgent.memberAgent.id;
	const agentProfileId = input.current.agentProfileId;
	useEffect(() => {
		if (organizationId && humanProfileId) {
			rememberMemberAgentChat(
				{ organizationId, humanProfileId },
				{ memberAgentId, agentProfileId, spaceId: input.spaceId }
			);
		}
	}, [
		organizationId,
		humanProfileId,
		memberAgentId,
		agentProfileId,
		input.spaceId,
	]);
	const sessionActions = useDirectMessageSessionActions({
		spaceId: input.spaceId,
		onLeave: () =>
			navigate({ to: buildOrganizationDirectMessagesPath(organization.slug) }),
	});
	const startNewChat = () =>
		sessionActions.run(async () => {
			const spaceId = await openMemberAgentChat({
				organizationId: organization.id,
				agentProfileId: input.current.agentProfileId,
			});
			await navigate({ to: sessions.sessionPath(spaceId) });
		}, "Couldn’t start a new chat. Try again.");
	// One list by last activity: a Profile is not a row of its own here, so
	// several Profiles name theirs on each chat instead of as group labels.
	const multipleProfiles = sessions.groups.length > 1;
	const chats = sortChatsByActivity(
		sessions.groups.flatMap((group) =>
			group.items.map((item) => ({
				...item,
				detail: multipleProfiles ? group.profileName : undefined,
			}))
		)
	);
	return (
		<>
			<ChatHistoryDropdown
				ariaLabel={`Open chats with ${input.current.memberAgent.displayName}: ${title}${titleStatusLabel ? `. Chats with status: ${titleStatusLabel}` : ""}`}
				currentSpaceId={input.spaceId}
				groups={[
					{
						id: "chats",
						items: chats.map((item) => {
							const indicators = resolveSpaceStatusIndicators(
								[item.spaceId],
								statusSources
							);
							return {
								...item,
								activityAt: item.timestamp,
								status: <SpaceStatusIndicator indicators={indicators} />,
								statusLabel: resolveSpaceStatusLabel(indicators),
							};
						}),
						isLoading: sessions.groups.some((group) => group.isLoading),
						isError: sessions.groups.some((group) => group.isError),
						onRetry: () => {
							for (const group of sessions.groups) {
								if (group.isError) {
									group.onRetry();
								}
							}
						},
					},
				]}
				newChatDisabled={sessionActions.pending}
				onNewChat={() => {
					startNewChat().catch(console.error);
				}}
				onSelect={(spaceId) => {
					navigate({ to: sessions.sessionPath(spaceId) });
				}}
				renderTrailingItems={sessionActions.renderMenuItems}
				title={title}
				titleAction={
					<ChatTitleEditor
						maxLength={AGENT_DIRECT_MESSAGE_SESSION_NAME_MAX_LENGTH}
						onSave={sessionActions.rename}
						title={title}
					/>
				}
				titleStatus={
					hasSpaceStatus(titleStatus) ? (
						<SpaceStatusIndicator indicators={titleStatus} />
					) : undefined
				}
			/>
			{sessionActions.dialogs}
		</>
	);
}

/** Opens a new Session with one agent Profile; returns its Space. */
export async function openMemberAgentChat(input: {
	organizationId: string;
	agentProfileId: string;
}): Promise<string> {
	const opened = await createDirectMessageApi(
		createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		})
	).openSpace({
		targetProfileId: input.agentProfileId,
		creationId: crypto.randomUUID(),
	});
	return opened.spaceId;
}

/** Most recent first: last message, else creation. */
export function sortChatsByActivity<
	T extends { timestamp?: number | null; createdAt?: string | null },
>(items: readonly T[]): T[] {
	const activity = (item: T) =>
		item.timestamp ?? (Date.parse(item.createdAt ?? "") || 0);
	return [...items].sort((left, right) => activity(right) - activity(left));
}

/**
 * A colleague's Agent as its Profiles, for a viewer who can't read the
 * owner's MemberAgent: the viewer's own chats group the same way.
 */
export type ColleagueSessionAgent = {
	harnessKind: HarnessKind | null;
	displayName: string;
	defaultProfileId: string | null;
	profiles: readonly { openMeldProfileId: string; profileName: string }[];
};

/**
 * Sessions of one MemberAgent grouped by Profile, shared by the chat header
 * dropdown and the conversations sidebar so both list the same Sessions.
 * The current Profile's list is always read so the open Session is named;
 * the others load when asked.
 */
export function useMemberAgentSessionGroups(input: {
	memberAgent: IndexedMemberAgent | null;
	/** Used when `memberAgent` is null, e.g. a colleague's Agent. */
	colleagueAgent?: ColleagueSessionAgent | null;
	currentProfileId: string | null;
	spaceId: string | null;
	includeAll: boolean;
	/** Lists archived Sessions instead of active ones. */
	archived?: boolean;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const humanProfileId = defaultHumanProfile?.openMeldProfileId;
	const memberAgent = input.memberAgent;
	const colleague = memberAgent ? null : (input.colleagueAgent ?? null);
	const profiles =
		memberAgent?.memberAgent.profiles ?? colleague?.profiles ?? [];
	const agentName = memberAgent?.displayName ?? colleague?.displayName ?? "";
	const defaultProfileId =
		memberAgent?.memberAgent.defaultProfileId ?? colleague?.defaultProfileId;
	const queries = useQueries({
		queries: profiles.map((profile) =>
			agentDirectMessageSessionsQueryOptions({
				organizationId: organization.id,
				agentProfileId: profile.openMeldProfileId,
				archived: input.archived === true,
				enabled:
					input.includeAll ||
					profile.openMeldProfileId === input.currentProfileId,
			})
		),
	});
	const memberAgents = useMemberAgentIndex();
	const archivedSessionIds = useArchivedMemberAgentSessionIds(memberAgents);
	const archivedCurrent = useQuery(
		agentDirectMessageSessionsQueryOptions({
			organizationId: organization.id,
			agentProfileId: input.currentProfileId ?? "",
			archived: true,
			enabled: Boolean(
				input.currentProfileId &&
					input.spaceId &&
					archivedSessionIds.has(input.spaceId)
			),
		})
	);
	// The header names the Session (a Space name, renamed or generated), not
	// the Agent the Direct Message is with.
	const currentSession = [
		...queries.flatMap((query) => query.data?.sessions ?? []),
		...(archivedCurrent.data?.sessions ?? []),
	].find((session) => session.spaceId === input.spaceId);
	const sessionPath = (spaceId: string) =>
		buildOrganizationDirectMessagePath({
			orgSlug: organization.slug,
			spaceId,
			search: { profileId: humanProfileId },
		});
	return {
		currentTitle: currentSession ? (currentSession.name ?? "New chat") : null,
		sessionPath,
		groups: profiles.map((profile, index) => {
			const query = queries[index];
			return {
				id: profile.openMeldProfileId,
				profileName: profile.profileName,
				label: formatMemberAgentProfileDisplayName({
					harnessKind:
						memberAgent?.harnessKind ?? colleague?.harnessKind ?? null,
					memberAgentName: agentName,
					profileName: profile.profileName,
					isDefaultProfile:
						("isDefault" in profile && profile.isDefault === true) ||
						profile.openMeldProfileId === defaultProfileId,
				}),
				items: (query?.data?.sessions ?? []).map((session) => ({
					spaceId: session.spaceId,
					title: session.name ?? "New chat",
					createdAt: session.createdAt,
					timestamp: session.messagePreview?.timestamp ?? null,
				})),
				isLoading: query?.isFetching === true && !query.data,
				isError: query?.isError === true,
				onRetry: () => {
					query?.refetch().catch(console.error);
				},
			};
		}),
	};
}

/**
 * Archive for a MemberAgent Session, in the shape of the existing chat-menu
 * archive (useChatArchive), so the chat menu keeps one Archive item and one
 * confirmation; it calls Core's Session archive instead of the personal list.
 */
export function useMemberAgentSessionArchive(
	spaceId: string,
	agentProfileId: string
) {
	const { currentOrganization: organization } = useAppOrganization();
	const navigate = useNavigate();
	const sessions = useQuery(
		agentDirectMessageSessionsQueryOptions({
			organizationId: organization.id,
			agentProfileId,
			archived: true,
			enabled: true,
		})
	);
	const archived =
		sessions.data?.sessions.some((session) => session.spaceId === spaceId) ===
		true;
	const actions = useDirectMessageSessionActions({
		spaceId,
		enabled: false,
		onLeave: () => undefined,
	});
	return {
		archived,
		disabled: actions.pending || !sessions.isSuccess,
		label: archived ? "Unarchive conversation" : "Archive conversation",
		confirmDescription:
			"It leaves your chat list. Its messages are kept, and you can restore it from the Archived tab on this Agent’s page.",
		toggle: async () => {
			const done = await actions.setArchived(!archived);
			if (done && !archived) {
				await navigate({
					to: buildOrganizationDirectMessagesPath(organization.slug),
				});
			}
			return done;
		},
	};
}
