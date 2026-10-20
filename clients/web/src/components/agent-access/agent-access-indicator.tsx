import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { HandIcon, KeyIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	type AgentViewerAccess,
	useAgentViewerAccess,
} from "#/lib/agents/agent-viewer-access";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
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
}): string {
	return input.access?.kind === "asks_owner"
		? "Ask to use"
		: `Chat with ${input.profileName}`;
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
