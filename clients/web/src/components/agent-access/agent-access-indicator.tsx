import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { HandIcon, KeyIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	type AgentViewerAccess,
	useAgentViewerAccess,
} from "#/lib/agents/agent-viewer-access";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useAgentAccessRequests } from "#/query/agent-access";
import { agentDirectMessageSessionsQueryOptions } from "#/query/organizations/agent-direct-message-sessions";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";

/** "You can use" or "Asks <owner>" for a colleague's Agent, in a meta line. */
export function AgentAccessIndicator(input: {
	access: AgentViewerAccess;
	className?: string;
}) {
	const canUse = input.access.kind === "can_use";
	const Icon = canUse ? KeyIcon : HandIcon;
	return (
		<TooltipHint
			content={
				canUse
					? `${input.access.ownerName} lets you start work with this Agent.`
					: `${input.access.ownerName} approves before it starts work for you.`
			}
		>
			<span
				className={cn(
					"inline-flex min-w-0 items-center gap-1 text-muted-foreground text-xs",
					input.className
				)}
				data-agent-access={input.access.kind}
				data-testid="agent-access-indicator"
			>
				<Icon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="truncate">
					{canUse ? "You can use" : `Asks ${input.access.ownerName}`}
				</span>
			</span>
		</TooltipHint>
	);
}

/**
 * How far the viewer got with an Agent whose owner answers first:
 * - `none`: no Direct Message with the Profile yet.
 * - `chat_open`: a Direct Message exists and nothing waits for the owner.
 * - `waiting`: the viewer's message waits for the owner's decision.
 */
export type ColleagueAgentChatProgress = "none" | "chat_open" | "waiting";

/** The colleague-facing label of the primary chat action. */
export function resolveAgentChatActionLabel(input: {
	access: AgentViewerAccess | null;
	profileName: string;
	progress?: ColleagueAgentChatProgress;
}): string {
	if (input.access?.kind !== "asks_owner") {
		return `Chat with ${input.profileName}`;
	}
	if (input.progress === "waiting") {
		return `Waiting for ${input.access.ownerName}`;
	}
	return input.progress === "chat_open" ? "Open chat" : "Ask to use";
}

/**
 * The viewer's progress with a colleague's Agent, from their pending
 * requests and their Direct Messages with the Profile.
 */
export function useColleagueAgentChatProgress(input: {
	enabled: boolean;
	profileId: string;
}): ColleagueAgentChatProgress {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	const requests = useAgentAccessRequests(
		{ role: "requester", status: "pending" },
		{ enabled: input.enabled }
	);
	const sessions = useQuery(
		agentDirectMessageSessionsQueryOptions({
			organizationId,
			agentProfileId: input.profileId,
			enabled: input.enabled && Boolean(organizationId),
		})
	);
	return resolveColleagueAgentChatProgress({
		hasDirectMessage: (sessions.data?.sessions.length ?? 0) > 0,
		pendingProfileIds: (requests.data ?? []).map(
			(request) => request.agentProfileId
		),
		profileId: input.profileId,
	});
}

export function resolveColleagueAgentChatProgress(input: {
	hasDirectMessage: boolean;
	pendingProfileIds: readonly string[];
	profileId: string;
}): ColleagueAgentChatProgress {
	if (input.pendingProfileIds.includes(input.profileId)) {
		return "waiting";
	}
	return input.hasDirectMessage ? "chat_open" : "none";
}

/** Access to a colleague's Agent, naming its owner from the directory. */
export function useColleagueAgentAccess(input: {
	profileId: string;
	ownerUserId: string | null;
}): AgentViewerAccess | null {
	const organization = useOptionalAppOrganization();
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: Boolean(organization && input.ownerUserId),
			organizationId: organization?.currentOrganization.id ?? "",
		})
	);
	return useAgentViewerAccess({
		ownerName: directory.data?.members.find(
			(member) => member.userId === input.ownerUserId
		)?.humanProfile?.profileName,
		ownerUserId: input.ownerUserId,
		profileId: input.profileId,
	});
}
