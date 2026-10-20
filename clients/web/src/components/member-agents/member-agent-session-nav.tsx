import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ChatCircleTextIcon, GearSixIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { AppContextualNavGroup } from "#/components/app/app-contextual-layout";
import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import { SpaceStatusIndicator } from "#/components/spaces/space-status-indicator";
import {
	resolveSpaceStatusIndicators,
	resolveSpaceStatusLabel,
	type SpaceStatusSources,
} from "#/components/spaces/space-status-indicators";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationAgentsPath } from "#/lib/organizations/organization-routes";
import { useMemberAgentSessionGroups } from "./member-agent-chat-history";
import { useMemberAgentIndex } from "./use-member-agents";

const SESSION_GROUP_PREFIX = "member-agent-sessions:";

/**
 * Open-state for the conversations sidebar groups: the open MemberAgent's
 * Session groups start open (the current Session must be visible) and fold
 * for this visit only; every other group keeps its saved state.
 */
export function useMemberAgentSessionDisclosure(disclosure: {
	isOpen: (id: string) => boolean;
	setOpen: (id: string, open: boolean) => void;
}) {
	const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
	return {
		isOpen: (id: string) =>
			id.includes(SESSION_GROUP_PREFIX)
				? !folded.has(id)
				: disclosure.isOpen(id),
		setOpen: (id: string, open: boolean) => {
			if (!id.includes(SESSION_GROUP_PREFIX)) {
				disclosure.setOpen(id, open);
				return;
			}
			setFolded((current) => {
				const next = new Set(current);
				if (open) {
					next.delete(id);
				} else {
					next.add(id);
				}
				return next;
			});
		},
	};
}

/**
 * Sidebar groups for the MemberAgent whose Session is open: one group per
 * Profile listing its Sessions, so the current Session is highlighted by the
 * sidebar's active item and any other is one click away. Lists the same
 * Sessions as the chat header dropdown, each with the status marks a sidebar
 * row shows, and links back to the MemberAgent's page, so a Session opened
 * from a deep link is never a dead end. Empty everywhere else.
 */
export function useActiveMemberAgentSessionNav(
	active: Conversation | undefined,
	statusSources: SpaceStatusSources
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
		id: `${SESSION_GROUP_PREFIX}${group.id}`,
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
		items: group.items.map((item) => {
			const indicators = resolveSpaceStatusIndicators(
				[item.spaceId],
				statusSources
			);
			const statusLabel = resolveSpaceStatusLabel(indicators);
			return {
				id: item.spaceId,
				icon: ChatCircleTextIcon,
				label: item.title,
				accessory: <SpaceStatusIndicator indicators={indicators} />,
				ariaLabel: statusLabel ? `${item.title}, ${statusLabel}` : undefined,
				to: sessions.sessionPath(item.spaceId),
			};
		}),
	}));
}
