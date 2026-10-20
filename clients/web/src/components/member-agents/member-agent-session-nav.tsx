import type { SidebarNestedNavSection } from "#/components/app/sidebar-nested-nav-list";
import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import { SpaceStatusIndicator } from "#/components/spaces/space-status-indicator";
import {
	resolveSpaceStatusIndicators,
	resolveSpaceStatusLabel,
	type SpaceStatusSources,
} from "#/components/spaces/space-status-indicators";
import { useSpaceStatusSources } from "#/components/spaces/use-space-status-sources";
import { useMemberAgentSessionGroups } from "./member-agent-chat-history";
import { useMemberAgentIndex } from "./use-member-agents";

type MemberAgentSessionGroups = ReturnType<typeof useMemberAgentSessionGroups>;

/**
 * One nested-list section per Profile, each Session with the status marks a
 * sidebar row shows.
 */
export function buildMemberAgentSessionSections(
	sessions: MemberAgentSessionGroups,
	statusSources: SpaceStatusSources
): SidebarNestedNavSection[] {
	return sessions.groups.map((group) => ({
		id: group.id,
		label: group.label,
		notice: group.isError ? "Couldn’t load chats." : undefined,
		items: group.items.map((item) => {
			const indicators = resolveSpaceStatusIndicators(
				[item.spaceId],
				statusSources
			);
			const statusLabel = resolveSpaceStatusLabel(indicators);
			return {
				id: item.spaceId,
				label: item.title,
				accessory: <SpaceStatusIndicator indicators={indicators} />,
				ariaLabel: statusLabel ? `${item.title}, ${statusLabel}` : undefined,
				to: sessions.sessionPath(item.spaceId),
			};
		}),
	}));
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
	if (!memberAgent) {
		return null;
	}
	return {
		memberAgentId: memberAgent.memberAgent.id,
		sections: buildMemberAgentSessionSections(sessions, statusSources),
	};
}

/**
 * Every Session of one MemberAgent, active or archived, by Profile, for the
 * Agent page sidebar. Sections keep the MemberAgent's Profile order.
 */
export function useMemberAgentPageSessionList(input: {
	memberAgentId: string;
	archived: boolean;
}): SidebarNestedNavSection[] {
	const memberAgents = useMemberAgentIndex();
	const memberAgent = memberAgents.index.byId.get(input.memberAgentId) ?? null;
	const sessions = useMemberAgentSessionGroups({
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
