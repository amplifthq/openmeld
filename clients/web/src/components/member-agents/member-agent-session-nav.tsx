import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ChatCircleTextIcon, GearSixIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { AppContextualNavGroup } from "#/components/app/app-contextual-layout";
import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationAgentsPath } from "#/lib/organizations/organization-routes";
import { useMemberAgentSessionGroups } from "./member-agent-chat-history";
import { useMemberAgentIndex } from "./use-member-agents";

/**
 * Sidebar groups for the MemberAgent whose Session is open: one group per
 * Profile listing its Sessions, so the current Session is highlighted by the
 * sidebar's active item and any other is one click away. Lists the same
 * Sessions as the chat header dropdown, and links back to the MemberAgent's
 * page, so a Session opened from a deep link is never a dead end. Empty
 * everywhere else.
 */
export function useActiveMemberAgentSessionNav(
	active: Conversation | undefined
): AppContextualNavGroup[] {
	const { currentOrganization } = useAppOrganization();
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
	const agentPagePath = `${buildOrganizationAgentsPath(currentOrganization.slug)}?memberAgentId=${encodeURIComponent(memberAgent.memberAgent.id)}`;
	return sessions.groups.map((group, index) => ({
		id: `member-agent-sessions:${group.id}`,
		label: group.label,
		ariaLabel: `${group.label} Sessions`,
		labelAccessory: (
			<>
				{group.isError ? (
					<span className="text-destructive text-xs">Couldn’t load</span>
				) : null}
				{index === 0 ? (
					<TooltipHint content={`Open ${memberAgent.displayName}`}>
						<Link
							aria-label={`Open ${memberAgent.displayName}`}
							className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
							to={agentPagePath}
						>
							<GearSixIcon aria-hidden="true" className="size-3.5" />
						</Link>
					</TooltipHint>
				) : null}
			</>
		),
		items: group.items.map((item) => ({
			id: item.spaceId,
			icon: ChatCircleTextIcon,
			label: item.title,
			to: sessions.sessionPath(item.spaceId),
		})),
	}));
}
