import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { SidebarNestedNavSection } from "#/components/app/sidebar-nested-nav-list";
import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import { SpaceProfileIcon } from "#/components/spaces/space-profile-icon";
import { SpaceStatusIndicator } from "#/components/spaces/space-status-indicator";
import {
	resolveSpaceStatusIndicators,
	resolveSpaceStatusLabel,
	type SpaceStatusSources,
} from "#/components/spaces/space-status-indicators";
import { useSpaceStatusSources } from "#/components/spaces/use-space-status-sources";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	type ColleagueSessionAgent,
	openMemberAgentChat,
	sortChatsByActivity,
	useMemberAgentSessionGroups,
} from "./member-agent-chat-history";
import {
	resolveMemberAgentLastChat,
	useMemberAgentLastChatScope,
} from "./member-agent-last-chat";
import { useMemberAgentIndex } from "./use-member-agents";

type MemberAgentSessionGroups = ReturnType<typeof useMemberAgentSessionGroups>;

/**
 * One nested-list section per Profile, each Session with the status marks a
 * sidebar row shows, most recent first. With `profileRows` and several
 * Profiles, each Profile gets a row that opens the chat last opened with it,
 * else its latest chat, or starts one when it has none.
 */
export function buildMemberAgentSessionSections(
	sessions: MemberAgentSessionGroups,
	statusSources: SpaceStatusSources,
	/** Fresher last-message times, e.g. the sidebar's live chat previews. */
	timestamps?: ReadonlyMap<string, number>,
	profileRows?: {
		onStartChat: (agentProfileId: string) => void;
		startingProfileId: string | null;
		/** The member's last-opened chat with a Profile, if still listed. */
		lastChatOf?: (
			agentProfileId: string,
			spaceIds: readonly string[]
		) => string | null;
	}
): SidebarNestedNavSection[] {
	return sessions.groups.map((group) => {
		const items = sortChatsByActivity(
			group.items.map((item) => ({
				...item,
				timestamp: timestamps?.get(item.spaceId) ?? item.timestamp,
			}))
		);
		// The row reopens the chat last opened with this Profile, else the latest.
		const lastChat = profileRows?.lastChatOf?.(
			group.id,
			items.map((item) => item.spaceId)
		);
		const latest = items.find((item) => item.spaceId === lastChat) ?? items[0];
		return {
			id: group.id,
			label: group.label,
			row:
				profileRows && sessions.groups.length > 1
					? {
							// The Agent row above names the Agent; this row names the Profile.
							label: group.profileName,
							ariaLabel: latest
								? `${group.label}, open latest chat`
								: `${group.label}, start a chat`,
							leading: (
								<SpaceProfileIcon
									agentControllerRef={null}
									className="size-4"
									profileId={group.id}
									profileKind="agent"
									profileName={group.profileName}
									size="xs"
								/>
							),
							to: latest ? sessions.sessionPath(latest.spaceId) : undefined,
							onSelect: () => profileRows.onStartChat(group.id),
							disabled: profileRows.startingProfileId === group.id,
						}
					: undefined,
			notice: group.isError ? "Couldn’t load chats." : undefined,
			items: items.map((item) => {
				const indicators = resolveSpaceStatusIndicators(
					[item.spaceId],
					statusSources
				);
				const statusLabel = resolveSpaceStatusLabel(indicators);
				return {
					id: item.spaceId,
					label: item.title,
					timestamp: item.timestamp,
					accessory: <SpaceStatusIndicator indicators={indicators} />,
					ariaLabel: statusLabel ? `${item.title}, ${statusLabel}` : undefined,
					to: sessions.sessionPath(item.spaceId),
				};
			}),
		};
	});
}

/**
 * Sessions of the MemberAgent whose Session is open, for the sidebar to nest
 * under that MemberAgent's row: one section per Profile, each Session with
 * the status marks a sidebar row shows. Lists the same Sessions as the chat
 * title dropdown. Null everywhere else.
 */
export function useActiveMemberAgentSessionList(
	active: Conversation | undefined,
	statusSources: SpaceStatusSources
): { memberAgentId: string; sections: SidebarNestedNavSection[] } | null {
	const memberAgents = useMemberAgentIndex();
	const memberAgent = active?.memberAgentId
		? (memberAgents.index.byId.get(active.memberAgentId) ?? null)
		: null;
	const currentProfileId =
		active?.kind === "direct-message"
			? (active.chat.peer?.profileId ?? null)
			: null;
	const sessions = useMemberAgentSessionGroups({
		memberAgent,
		currentProfileId,
		spaceId: active?.spaceId ?? null,
		includeAll: Boolean(memberAgent),
	});
	const { currentOrganization: organization } = useAppOrganization();
	const navigate = useNavigate();
	const [startingProfileId, setStartingProfileId] = useState<string | null>(
		null
	);
	const lastChatScope = useMemberAgentLastChatScope();
	if (!memberAgent) {
		return null;
	}
	const onStartChat = (agentProfileId: string) => {
		setStartingProfileId(agentProfileId);
		openMemberAgentChat({
			organizationId: organization.id,
			agentProfileId,
		})
			.then((spaceId) => navigate({ to: sessions.sessionPath(spaceId) }))
			.catch((error: unknown) => {
				console.error("Could not start a chat", error);
				toast.error("Couldn’t start a new chat. Try again.");
			})
			.finally(() => setStartingProfileId(null));
	};
	return {
		memberAgentId: memberAgent.memberAgent.id,
		sections: buildMemberAgentSessionSections(
			sessions,
			statusSources,
			active?.memberAgentSessionTimestamps,
			{
				onStartChat,
				startingProfileId,
				lastChatOf: (agentProfileId, spaceIds) =>
					resolveMemberAgentLastChat({
						scope: lastChatScope,
						target: { agentProfileId },
						available: spaceIds,
						complete: false,
					}),
			}
		),
	};
}

/**
 * Every Session of one MemberAgent, active or archived, by Profile, for the
 * Agent page sidebar. Sections keep the MemberAgent's Profile order.
 */
export function useMemberAgentPageSessionList(input: {
	/** Null for a colleague's Agent, listed by `colleagueAgent` instead. */
	memberAgentId: string | null;
	colleagueAgent?: ColleagueSessionAgent | null;
	archived: boolean;
}): SidebarNestedNavSection[] {
	const memberAgents = useMemberAgentIndex();
	const memberAgent = input.memberAgentId
		? (memberAgents.index.byId.get(input.memberAgentId) ?? null)
		: null;
	const sessions = useMemberAgentSessionGroups({
		colleagueAgent: input.colleagueAgent,
		memberAgent,
		currentProfileId: null,
		spaceId: null,
		includeAll: true,
		archived: input.archived,
	});
	const statusSources = useSpaceStatusSources({
		currentSpaceId: "",
		spaceIds: sessions.groups.flatMap((group) =>
			group.items.map((item) => item.spaceId)
		),
	});
	return buildMemberAgentSessionSections(sessions, statusSources);
}
