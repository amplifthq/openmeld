import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { HandIcon, KeyIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	type AgentViewerAccess,
	useAgentViewerAccess,
} from "#/lib/agents/agent-viewer-access";
import type { ColleagueAccess } from "#/lib/agents/colleague-access-state";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationDirectMessagePath } from "#/lib/organizations/organization-routes";
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

/** The colleague-facing label of the primary chat action. */
export function resolveAgentChatActionLabel(input: {
	access: AgentViewerAccess | null;
	profileName: string;
	/** The shared colleague state; without it the label follows `access`. */
	colleagueAccess?: ColleagueAccess | null;
}): string {
	const chat = `Chat with ${input.profileName}`;
	if (input.access?.kind !== "asks_owner") {
		return chat;
	}
	const state = input.colleagueAccess?.state;
	switch (state) {
		case undefined:
		case "none":
		case "draft":
		// Revoked access starts a new request.
		case "revoked":
			return "Ask to use";
		case "waiting":
			return `Waiting for ${input.colleagueAccess?.ownerName ?? input.access.ownerName}`;
		case "approved_once":
		case "always_allowed":
		case "not_required":
			return chat;
		case "declined":
			return "Declined";
		default:
			return assertNeverColleagueState(state);
	}
}

/** Fails the type check when the shared colleague state gains a case. */
export function assertNeverColleagueState(state: never): never {
	throw new Error(`Unhandled colleague access state: ${String(state)}`);
}

/**
 * The Direct Message a colleague's chat action opens directly: the request's
 * own Space while it waits, once it is allowed for one chat, or after a
 * decline. Null opens the current one.
 */
export function resolveColleagueRequestSpaceId(
	colleagueAccess: ColleagueAccess | null | undefined
): string | null {
	const state = colleagueAccess?.state;
	switch (state) {
		case "waiting":
		case "approved_once":
		case "declined":
			return colleagueAccess?.request?.spaceId ?? null;
		case undefined:
		case "none":
		case "draft":
		case "always_allowed":
		case "not_required":
		case "revoked":
			return null;
		default:
			return assertNeverColleagueState(state);
	}
}

/** Opens a colleague's request Direct Message by its Space. */
export function useOpenColleagueRequestSpace() {
	const navigate = useNavigate();
	const orgSlug = useOptionalAppOrganization()?.currentOrganization.slug;
	return (spaceId: string) => {
		if (!orgSlug) {
			return;
		}
		navigate({
			to: buildOrganizationDirectMessagePath({ orgSlug, spaceId }),
		}).catch(console.error);
	};
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
