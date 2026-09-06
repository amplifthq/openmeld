"use client";

import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import {
	SidebarMenuActions,
	SidebarMenuButton,
} from "@openmeld/ui/fluid/sidebar-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, StarIcon } from "@phosphor-icons/react";
import { type ReactNode, useMemo } from "react";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import { DirectoryHumanProfileAvatar } from "#/components/directory/directory-human-profile-avatar";
import {
	resolveDirectoryHumanProfileActivityLabel,
	resolveDirectoryHumanProfileActivityTooltipLabel,
} from "#/components/directory/directory-human-profile-format";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import {
	DirectoryComputerStatusIcon,
	DirectoryIdentityAccountSummary,
} from "#/components/directory/directory-human-profile-presentation";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import type { useSortableSidebarItem } from "../app/sidebar-drag";
import { SidebarRowAction as PeopleRowAction } from "../app/sidebar-row-action";

const MAX_VISIBLE_SIDEBAR_LOCAL_AGENTS = 4;
export function HumanProfileSidebarItem(input: {
	activityNowMs: number;
	computerGroup: OrganizationComputerGroup | null;
	index: number;
	isActive: boolean;
	member: DirectoryHumanProfileRow;
	onSelect: (profileId: string) => void;
	drag?: ReturnType<typeof useSortableSidebarItem>;
	starred?: boolean;
	actionsDisabled?: boolean;
	onToggleStar?: () => void;
	onChat?: () => void;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const activityLabel = resolveDirectoryHumanProfileActivityLabel({
		lastActiveAt: input.member.lastActiveAt,
		nowMs: input.activityNowMs,
		profileStatus: input.member.profileStatus,
	});
	const activityTooltipLabel = resolveDirectoryHumanProfileActivityTooltipLabel(
		{
			lastActiveAt: input.member.lastActiveAt,
			nowMs: input.activityNowMs,
			profileStatus: input.member.profileStatus,
		}
	);
	const localAgents = useMemo(
		() => resolveEnabledLocalAgents(input.computerGroup),
		[input.computerGroup]
	);
	const mappedAccounts = input.member.identityAccounts.filter(
		(account) => account.id !== null
	);
	const visibleLocalAgents = localAgents.slice(
		0,
		MAX_VISIBLE_SIDEBAR_LOCAL_AGENTS
	);
	const hiddenLocalAgentCount = localAgents.length - visibleLocalAgents.length;
	let activityContent: ReactNode = null;
	if (activityLabel) {
		activityContent = activityTooltipLabel ? (
			<Tooltip>
				<TooltipTrigger
					render={
						<span
							className="min-w-0 truncate text-muted-foreground text-xs"
							data-slot="human-profile-last-seen"
						/>
					}
				>
					{activityLabel}
				</TooltipTrigger>
				<TooltipContent side="top" sideOffset={6}>
					{activityTooltipLabel}
				</TooltipContent>
			</Tooltip>
		) : (
			<span className="min-w-0 truncate text-muted-foreground text-xs">
				{activityLabel}
			</span>
		);
	}
	return (
		<FluidNavMenuItem
			className="relative"
			index={input.index}
			ref={input.drag?.ref}
			style={input.drag?.style}
			value={input.member.id}
		>
			<SidebarMenuButton
				actionLayout="heading"
				isActive={input.isActive}
				{...input.drag?.rowProps}
				aria-current={input.isActive ? "page" : undefined}
				aria-label={`Open ${input.member.name}'s profile`}
				className={cn(
					"h-auto min-w-0 flex-row items-start gap-1.5 py-1 text-left outline-none",
					APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
					APP_NAV_ITEM_TONE_CLASS_NAME,
					input.isActive ? "text-sidebar-accent-foreground" : null
				)}
				onClick={() => {
					input.onSelect(input.member.id);
					dismiss();
				}}
				type="button"
			>
				<DirectoryHumanProfileAvatar context="sidebar" member={input.member} />
				<span className="flex min-w-0 flex-1 flex-col overflow-hidden">
					<span
						className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap"
						data-sidebar="menu-heading"
						data-slot="human-profile-sidebar-heading"
					>
						<span className="min-w-0 truncate font-medium text-[13px]">
							{input.member.name}
						</span>
						<DirectoryComputerStatusIcon member={input.member} />
						{input.member.isCurrentUser ? (
							<span className="shrink-0 text-muted-foreground text-xs">
								(you)
							</span>
						) : null}
					</span>
					{mappedAccounts.length > 0 ? (
						<span
							className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap"
							data-slot="human-profile-channel-identities"
						>
							{mappedAccounts.map((account) => (
								<span
									className="min-w-0 shrink overflow-hidden"
									key={account.provider}
								>
									<DirectoryIdentityAccountSummary
										account={account}
										context="sidebar"
									/>
								</span>
							))}
						</span>
					) : null}
					{activityLabel || localAgents.length > 0 ? (
						<span
							className="flex min-h-4 min-w-0 items-center justify-between gap-2"
							data-slot="human-profile-activity-and-local-agents"
						>
							{activityContent}
							{localAgents.length > 0 ? (
								<span
									aria-label={buildLocalAgentSummary(localAgents)}
									className="ml-auto flex shrink-0 items-center justify-end -space-x-1.5"
									role="img"
								>
									{visibleLocalAgents.map((agent) => (
										<Tooltip key={agent.agentId}>
											<TooltipTrigger
												render={
													<span
														aria-hidden="true"
														className="group/local-agent relative z-0 grid size-4 shrink-0 place-items-center hover:z-20"
														data-testid="human-profile-local-agent"
													/>
												}
											>
												<span
													className="relative isolate inline-grid size-4 overflow-hidden rounded-sm bg-sidebar p-px transition-transform duration-150 ease-[cubic-bezier(0.19,1,0.22,1)] before:absolute before:inset-0 before:bg-sidebar-accent before:content-[''] group-hover/local-agent:-translate-y-1 group-hover/local-agent:scale-[1.14] motion-reduce:transform-none motion-reduce:transition-none"
													data-slot="human-profile-local-agent-logo"
												>
													<LocalAgentLogo
														agentId={agent.agentId}
														className="relative z-10"
														size="xs"
													/>
												</span>
											</TooltipTrigger>
											<TooltipContent side="top" sideOffset={6}>
												{agent.displayName}
											</TooltipContent>
										</Tooltip>
									))}
									{hiddenLocalAgentCount > 0 ? (
										<Tooltip>
											<TooltipTrigger
												render={
													<span className="relative isolate z-10 inline-flex h-4 min-w-4 items-center justify-center overflow-hidden rounded-full bg-sidebar px-0.5 font-medium text-[9px] text-muted-foreground before:absolute before:inset-0 before:bg-sidebar-accent before:content-['']" />
												}
											>
												<span className="relative z-10">
													+{hiddenLocalAgentCount}
												</span>
											</TooltipTrigger>
											<TooltipContent side="top" sideOffset={6}>
												{localAgents
													.slice(MAX_VISIBLE_SIDEBAR_LOCAL_AGENTS)
													.map((agent) => agent.displayName)
													.join(", ")}
											</TooltipContent>
										</Tooltip>
									) : null}
								</span>
							) : null}
						</span>
					) : null}
				</span>
			</SidebarMenuButton>
			{input.onToggleStar && (
				<SidebarMenuActions className="top-1" showOnHover>
					{input.onChat && (
						<PeopleRowAction
							disabled={input.actionsDisabled}
							label={`Chat with ${input.member.name}`}
							onClick={input.onChat}
						>
							<ChatCircleTextIcon />
						</PeopleRowAction>
					)}
					<PeopleRowAction
						disabled={input.actionsDisabled}
						label={`${input.starred ? "Unstar" : "Star"} ${input.member.name}`}
						onClick={input.onToggleStar}
					>
						<StarIcon weight={input.starred ? "fill" : "regular"} />
					</PeopleRowAction>
				</SidebarMenuActions>
			)}
		</FluidNavMenuItem>
	);
}

type LocalAgentIdentity = { agentId: string; displayName: string };

function resolveEnabledLocalAgents(
	group: OrganizationComputerGroup | null
): readonly LocalAgentIdentity[] {
	if (!group) {
		return [];
	}
	const agents = new Map<string, LocalAgentIdentity>();
	for (const computer of group.computers) {
		if (computer.ownedComputer) {
			appendOwnedComputerLocalAgents(
				agents,
				computer.ownedComputer.executionTargets
			);
			continue;
		}
		appendOrganizationComputerLocalAgents(agents, computer.localAgents);
	}
	return [...agents.values()].sort((left, right) =>
		left.displayName.localeCompare(right.displayName, "en", {
			sensitivity: "base",
		})
	);
}

function appendOwnedComputerLocalAgents(
	agents: Map<string, LocalAgentIdentity>,
	executionTargets: NonNullable<
		OrganizationComputerGroup["computers"][number]["ownedComputer"]
	>["executionTargets"]
): void {
	for (const target of executionTargets) {
		if (target.status === "stale") {
			continue;
		}
		for (const entry of target.localAgentCatalog.entries) {
			if (
				entry.enabled &&
				entry.detected &&
				entry.lifecycleStatus !== "suspended" &&
				hasLocalAgentLogo(entry.agentId)
			) {
				agents.set(entry.agentId, {
					agentId: entry.agentId,
					displayName: entry.displayName,
				});
			}
		}
	}
}

function appendOrganizationComputerLocalAgents(
	agents: Map<string, LocalAgentIdentity>,
	localAgents: OrganizationComputerGroup["computers"][number]["localAgents"]
): void {
	for (const localAgent of localAgents) {
		const parsed = parseAgentControllerRef(localAgent.agentControllerRef);
		if (
			localAgent.enabled &&
			parsed?.kind === "builtin" &&
			hasLocalAgentLogo(parsed.id)
		) {
			agents.set(parsed.id, {
				agentId: parsed.id,
				displayName: formatLocalAgentDisplayName(parsed.id),
			});
		}
	}
}

function buildLocalAgentSummary(
	localAgents: readonly LocalAgentIdentity[]
): string {
	return localAgents.map((agent) => `${agent.displayName} enabled`).join(", ");
}
