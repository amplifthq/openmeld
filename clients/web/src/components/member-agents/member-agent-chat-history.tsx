import { createDirectMessageApi } from "@openmeld/api-client";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChatTitleEditor } from "#/components/organizations/chat-title-editor";
import { ChatHistoryDropdown } from "#/components/spaces/chat-history-dropdown";
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
	title: string;
	current: DirectMessageMemberAgent;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const sessions = useMemberAgentSessionGroups({
		memberAgent: input.current.memberAgent,
		currentProfileId: input.current.agentProfileId,
		spaceId: input.spaceId,
		includeAll: open,
	});
	const title = sessions.currentTitle ?? input.title;
	const sessionActions = useDirectMessageSessionActions({
		spaceId: input.spaceId,
		onLeave: () =>
			navigate({ to: buildOrganizationDirectMessagesPath(organization.slug) }),
	});
	const startNewChat = () =>
		sessionActions.run(async () => {
			const opened = await createDirectMessageApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: organization.id,
				})
			).openSpace({
				targetProfileId: input.current.agentProfileId,
				creationId: crypto.randomUUID(),
			});
			await navigate({ to: sessions.sessionPath(opened.spaceId) });
		}, "Couldn’t start a new chat. Try again.");
	return (
		<>
			<ChatHistoryDropdown
				ariaLabel={`Open chats with ${input.current.memberAgent.displayName}: ${title}`}
				currentSpaceId={input.spaceId}
				groups={sessions.groups}
				newChatDisabled={sessionActions.pending}
				onNewChat={() => {
					startNewChat().catch(console.error);
				}}
				onOpenChange={setOpen}
				onSelect={(spaceId) => {
					navigate({ to: sessions.sessionPath(spaceId) });
				}}
				renderTrailingItems={sessionActions.renderMenuItems}
				title={title}
				titleAction={
					<ChatTitleEditor onSave={sessionActions.rename} title={title} />
				}
			/>
			{sessionActions.dialogs}
		</>
	);
}

/**
 * Sessions of one MemberAgent grouped by Profile, shared by the chat header
 * dropdown and the conversations sidebar so both list the same Sessions.
 * The current Profile's list is always read so the open Session is named;
 * the others load when asked.
 */
export function useMemberAgentSessionGroups(input: {
	memberAgent: IndexedMemberAgent | null;
	currentProfileId: string | null;
	spaceId: string | null;
	includeAll: boolean;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const humanProfileId = defaultHumanProfile?.openMeldProfileId;
	const memberAgent = input.memberAgent;
	const profiles = memberAgent?.memberAgent.profiles ?? [];
	const queries = useQueries({
		queries: profiles.map((profile) =>
			agentDirectMessageSessionsQueryOptions({
				organizationId: organization.id,
				agentProfileId: profile.openMeldProfileId,
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
				label: formatMemberAgentProfileDisplayName({
					memberAgentName: memberAgent?.displayName ?? "",
					profileName: profile.profileName,
					isDefaultProfile:
						profile.isDefault ||
						profile.openMeldProfileId ===
							memberAgent?.memberAgent.defaultProfileId,
				}),
				items: (query?.data?.sessions ?? []).map((session) => ({
					spaceId: session.spaceId,
					title: session.name ?? "New chat",
					createdAt: session.createdAt,
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
export function useMemberAgentSessionArchive(spaceId: string) {
	const { currentOrganization: organization } = useAppOrganization();
	const navigate = useNavigate();
	const memberAgents = useMemberAgentIndex();
	const archived = useArchivedMemberAgentSessionIds(memberAgents).has(spaceId);
	const actions = useDirectMessageSessionActions({
		spaceId,
		enabled: false,
		onLeave: () => undefined,
	});
	return {
		archived,
		disabled: actions.pending,
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
