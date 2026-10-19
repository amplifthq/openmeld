import { ChatCircleTextIcon } from "@phosphor-icons/react";
import type { AppContextualNavGroup } from "#/components/app/app-contextual-layout";
import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import { useMemberAgentSessionGroups } from "./member-agent-chat-history";
import { useMemberAgentIndex } from "./use-member-agents";

/**
 * Sidebar groups for the MemberAgent whose Session is open: one group per
 * Profile listing its Sessions, so the current Session is highlighted by the
 * sidebar's active item and any other is one click away. Lists the same
 * Sessions as the chat header dropdown. Empty everywhere else.
 */
export function useActiveMemberAgentSessionNav(
	active: Conversation | undefined
): AppContextualNavGroup[] {
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
		return [];
	}
	return sessions.groups.map((group) => ({
		id: `member-agent-sessions:${group.id}`,
		label: group.label,
		ariaLabel: `${group.label} Sessions`,
		labelAccessory: group.isError ? (
			<span className="text-destructive text-xs">Couldn’t load</span>
		) : undefined,
		items: group.items.map((item) => ({
			id: item.spaceId,
			icon: ChatCircleTextIcon,
			label: item.title,
			to: sessions.sessionPath(item.spaceId),
		})),
	}));
}
