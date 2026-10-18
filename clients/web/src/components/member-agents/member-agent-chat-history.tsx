import { createDirectMessageApi } from "@openmeld/api-client";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { buttonVariants } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretDownIcon, PlusIcon } from "@phosphor-icons/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
 * Header dropdown of a MemberAgent Direct Message: its Sessions grouped by
 * Profile, New Chat, and the dedicated rename, archive, and delete
 * operations for the current Session. Nothing is archived automatically.
 */
export function MemberAgentChatHistory(input: {
	spaceId: string;
	title: string;
	current: DirectMessageMemberAgent;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const humanProfileId = defaultHumanProfile?.openMeldProfileId;
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const { memberAgent } = input.current;
	const profiles = memberAgent.memberAgent.profiles;
	const sessions = useQueries({
		queries: profiles.map((profile) =>
			agentDirectMessageSessionsQueryOptions({
				organizationId: organization.id,
				agentProfileId: profile.openMeldProfileId,
				// The current Profile's list also names the open Session.
				enabled:
					open || profile.openMeldProfileId === input.current.agentProfileId,
			})
		),
	});
	const sessionPath = (spaceId: string) =>
		buildOrganizationDirectMessagePath({
			orgSlug: organization.slug,
			spaceId,
			search: { profileId: humanProfileId },
		});
	const memberAgents = useMemberAgentIndex();
	const archivedSessionIds = useArchivedMemberAgentSessionIds(memberAgents);
	const archivedCurrent = useQuery(
		agentDirectMessageSessionsQueryOptions({
			organizationId: organization.id,
			agentProfileId: input.current.agentProfileId,
			archived: true,
			enabled: archivedSessionIds.has(input.spaceId),
		})
	);
	// The header names the Session (a Space name, renamed or generated), not
	// the Agent the Direct Message is with.
	const currentSession = [
		...sessions.flatMap((query) => query.data?.sessions ?? []),
		...(archivedCurrent.data?.sessions ?? []),
	].find((session) => session.spaceId === input.spaceId);
	const title = currentSession
		? (currentSession.name ?? "New chat")
		: input.title;
	const sessionActions = useDirectMessageSessionActions({
		archived: archivedSessionIds.has(input.spaceId),
		spaceId: input.spaceId,
		title,
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
			setOpen(false);
			await navigate({ to: sessionPath(opened.spaceId) });
		}, "Couldn’t start a new chat. Try again.");
	let itemIndex = 1;
	return (
		<>
			<h1
				className={cn(
					buttonVariants({ variant: "ghost" }),
					"relative ml-[var(--space-title-control-inline-offset,0px)] h-auto min-w-0 max-w-[28rem] shrink gap-0 rounded-full border-0 p-0 text-lg transition-none hover:shadow-sm",
					open && "bg-muted shadow-sm"
				)}
			>
				<DropdownMenu modal={false} onOpenChange={setOpen} open={open}>
					<TooltipHint content={open ? undefined : "Open chats"}>
						<DropdownMenuTrigger
							aria-label={`Open chats with ${memberAgent.displayName}: ${title}`}
							className="flex min-w-0 items-center rounded-full px-2 py-1 text-lg outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
						>
							<span className="truncate">{title}</span>
							<CaretDownIcon
								aria-hidden="true"
								className="ml-1 size-3.5 shrink-0 text-muted-foreground"
							/>
						</DropdownMenuTrigger>
					</TooltipHint>
					<FluidDropdownMenuContent
						align="start"
						className="max-h-[min(28rem,var(--available-height))] w-[min(24rem,calc(100vw-2rem))] rounded-xl"
						sideOffset={8}
					>
						<FluidDropdownMenuItem
							className="my-1 px-3 text-sm"
							disabled={sessionActions.pending}
							index={0}
							onClick={startNewChat}
						>
							<PlusIcon aria-hidden="true" />
							New chat
						</FluidDropdownMenuItem>
						{profiles.map((profile, profileIndex) => {
							const query = sessions[profileIndex];
							const label = formatMemberAgentProfileDisplayName({
								memberAgentName: memberAgent.displayName,
								profileName: profile.profileName,
								isDefaultProfile:
									profile.isDefault ||
									profile.openMeldProfileId ===
										memberAgent.memberAgent.defaultProfileId,
							});
							return (
								<div key={profile.openMeldProfileId}>
									<div className="px-3 pt-3 pb-1 text-muted-foreground text-xs">
										{label}
									</div>
									{query?.isError ? (
										<p className="px-3 py-2 text-muted-foreground text-sm">
											Couldn’t load these chats.
										</p>
									) : null}
									{query?.isPending && open ? (
										<output className="block px-3 py-2 text-muted-foreground text-sm">
											Loading chats…
										</output>
									) : null}
									{query?.data?.sessions.length === 0 ? (
										<p className="px-3 py-2 text-muted-foreground text-sm">
											No chats yet.
										</p>
									) : null}
									{(query?.data?.sessions ?? []).map((session) => {
										itemIndex += 1;
										return (
											<FluidDropdownMenuItem
												aria-current={
													session.spaceId === input.spaceId ? "page" : undefined
												}
												className="gap-3 px-3 py-2 text-sm"
												index={itemIndex}
												key={session.spaceId}
												onClick={() => {
													setOpen(false);
													navigate({ to: sessionPath(session.spaceId) }).catch(
														console.error
													);
												}}
											>
												<span className="min-w-0 flex-1 truncate">
													{session.name ?? "New chat"}
												</span>
												{session.spaceId === input.spaceId ? (
													<span className="shrink-0 text-muted-foreground text-xs">
														Current
													</span>
												) : null}
											</FluidDropdownMenuItem>
										);
									})}
								</div>
							);
						})}
						{sessionActions.renderMenuItems(itemIndex + 1)}
					</FluidDropdownMenuContent>
				</DropdownMenu>
			</h1>
			{sessionActions.dialogs}
		</>
	);
}
