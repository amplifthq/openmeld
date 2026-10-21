"use client";

import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import {
	type LocalAgentUsageSource,
	SettingsLocalAgentUsageDockItem,
} from "@openmeld/ui/components/settings-computers";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidCardItem } from "@openmeld/ui/fluid/card";
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
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
import { ProfileMenuItems } from "#/components/app/profile-menu-items";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import { DirectoryHumanProfileAvatar } from "#/components/directory/directory-human-profile-avatar";
import {
	resolveDirectoryHumanProfileActivityLabel,
	resolveDirectoryHumanProfileActivityTooltipLabel,
} from "#/components/directory/directory-human-profile-format";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import { DirectoryComputerStatusIcon } from "#/components/directory/directory-human-profile-presentation";
import { resolveAgentUsageAttention } from "#/components/profiles/agent-usage-attention";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationPersonPath } from "#/lib/organizations/organization-routes";
import type { useSortableSidebarItem } from "../app/sidebar-drag";
import { SidebarRowAction as PeopleRowAction } from "../app/sidebar-row-action";

const MAX_VISIBLE_SIDEBAR_LOCAL_AGENTS = 4;
export function HumanProfileItem(input: {
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
	presentation?: "card" | "sidebar";
}) {
	const { dismiss } = useAppNavigationPresentation();
	const { currentOrganization } = useAppOrganization();
	const menu = (
		<ProfileMenuItems
			disabled={input.actionsDisabled}
			href={buildOrganizationPersonPath({
				orgSlug: currentOrganization.slug,
				personId: input.member.id,
			})}
			onChat={input.onChat}
			onOpen={() => {
				input.onSelect(input.member.id);
				dismiss();
			}}
			onToggleStar={input.onToggleStar}
			starred={input.starred}
		/>
	);
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

	const card = input.presentation === "card";
	const presentation = resolveItemPresentation(
		card,
		activityLabel,
		activityTooltipLabel,
		localAgents.length
	);
	const row = (
		<SidebarMenuButton
			actionLayout="heading"
			isActive={input.isActive}
			{...input.drag?.rowProps}
			aria-current={input.isActive ? "page" : undefined}
			aria-description={input.member.computer.label}
			aria-label={`Open ${input.member.name}'s profile`}
			className={cn(
				"h-auto min-w-0 flex-row items-start gap-2 py-1 text-left outline-none",
				APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
				APP_NAV_ITEM_TONE_CLASS_NAME,
				card && "min-h-24 w-full items-center gap-3 p-4 text-foreground",
				input.isActive ? "text-sidebar-accent-foreground" : null
			)}
			onClick={() => {
				input.onSelect(input.member.id);
				dismiss();
			}}
			type="button"
		>
			<DirectoryHumanProfileAvatar
				context={presentation.avatarContext}
				member={input.member}
			/>
			<span
				className={cn(
					"flex min-w-0 flex-1 flex-col overflow-hidden",
					presentation.contentClassName
				)}
			>
				<span
					className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap"
					data-sidebar="menu-heading"
					data-slot="human-profile-sidebar-heading"
				>
					<span
						className={cn(
							"min-w-0 truncate font-medium text-[13px]",
							card && "text-sm"
						)}
					>
						{input.member.name}
					</span>
					<DirectoryComputerStatusIcon member={input.member} />
					{input.member.isCurrentUser ? (
						<span className="shrink-0 text-muted-foreground text-xs">
							(you)
						</span>
					) : null}
				</span>
				{presentation.showSecondary ? (
					<span
						className="flex min-h-4 min-w-0 shrink-0 items-center justify-between gap-2"
						data-slot="human-profile-activity-and-local-agents"
					>
						{presentation.activity}
						{!card && (
							<HumanLocalAgentDock
								card={false}
								className={presentation.agentClassName}
								localAgents={localAgents}
								nowMs={input.activityNowMs}
							/>
						)}
					</span>
				) : null}
			</span>
			{card && (
				<HumanLocalAgentDock
					card
					className={presentation.agentClassName}
					localAgents={localAgents}
					nowMs={input.activityNowMs}
				/>
			)}
		</SidebarMenuButton>
	);
	if (card) {
		return (
			<FluidContextMenu
				target={
					<FluidCardItem
						className="border border-border"
						itemId={input.member.id}
						role="listitem"
					>
						{row}
					</FluidCardItem>
				}
			>
				{menu}
			</FluidContextMenu>
		);
	}
	return (
		<FluidContextMenu
			target={
				<FluidNavMenuItem
					className="relative"
					index={input.index}
					ref={input.drag?.ref}
					style={input.drag?.style}
					value={input.member.id}
				>
					{row}
					{input.onToggleStar && (
						<SidebarMenuActions showOnHover>
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
			}
		>
			{menu}
		</FluidContextMenu>
	);
}

function HumanLocalAgentDock({
	localAgents,
	card,
	nowMs,
	className,
}: {
	localAgents: readonly LocalAgentIdentity[];
	card: boolean;
	nowMs: number;
	className: string;
}) {
	if (localAgents.length === 0) {
		return null;
	}
	const visibleLocalAgents = localAgents.slice(
		0,
		MAX_VISIBLE_SIDEBAR_LOCAL_AGENTS
	);
	const hiddenLocalAgentCount = localAgents.length - visibleLocalAgents.length;
	if (card) {
		const orderedAgents = localAgents.toSorted(
			(left, right) =>
				resolveAttentionUsageSources(right.usageSources, nowMs).length -
				resolveAttentionUsageSources(left.usageSources, nowMs).length
		);
		return (
			<span
				className="isolate ml-auto flex max-w-full items-end justify-end -space-x-2.25"
				data-slot="human-profile-local-agent-dock"
			>
				{orderedAgents.map((agent, index) => (
					<SettingsLocalAgentUsageDockItem
						agentName={agent.displayName}
						key={agent.agentId}
						nowMs={nowMs}
						sources={resolveAttentionUsageSources(agent.usageSources, nowMs)}
						stackOrder={localAgents.length - index}
					>
						<LocalAgentLogo
							agentId={agent.agentId}
							className="size-[22.5px] rounded-sm"
							size="sm"
							variant="tile"
						/>
					</SettingsLocalAgentUsageDockItem>
				))}
			</span>
		);
	}
	return (
		<span
			aria-label={buildLocalAgentSummary(localAgents)}
			className={cn("flex shrink-0 items-center -space-x-1.5", className)}
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
						<span className="relative z-10">+{hiddenLocalAgentCount}</span>
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
	);
}

type LocalAgentIdentity = {
	agentId: string;
	displayName: string;
	usageSources: LocalAgentUsageSource[];
};

function resolveItemPresentation(
	card: boolean,
	label: string | null,
	tooltip: string | null,
	agentCount: number
) {
	return {
		avatarContext: card ? ("card" as const) : ("sidebar" as const),
		showSecondary: (card && Boolean(label)) || agentCount > 0,
		activity: card ? renderActivityLabel(label, tooltip) : null,
		agentClassName: card ? "ml-auto justify-end" : "justify-start",
		contentClassName: card ? undefined : "gap-1.5",
	};
}

function renderActivityLabel(
	label: string | null,
	tooltip: string | null
): ReactNode {
	if (!label) {
		return null;
	}
	const content = (
		<span
			className="min-w-0 truncate text-muted-foreground text-xs"
			data-slot="human-profile-last-seen"
		>
			{label}
		</span>
	);
	return tooltip ? (
		<Tooltip>
			<TooltipTrigger render={content}>{label}</TooltipTrigger>
			<TooltipContent side="top" sideOffset={6}>
				{tooltip}
			</TooltipContent>
		</Tooltip>
	) : (
		content
	);
}

function resolveEnabledLocalAgents(
	group: OrganizationComputerGroup | null
): readonly LocalAgentIdentity[] {
	if (!group) {
		return [];
	}
	const agents = new Map<string, LocalAgentIdentity>();
	for (const computer of group.computers) {
		if (computer.ownedComputer) {
			appendOwnedComputerLocalAgents(agents, computer);
			continue;
		}
		appendOrganizationComputerLocalAgents(agents, computer);
	}
	return [...agents.values()].sort((left, right) =>
		left.displayName.localeCompare(right.displayName, "en", {
			sensitivity: "base",
		})
	);
}

function appendOwnedComputerLocalAgents(
	agents: Map<string, LocalAgentIdentity>,
	computer: OrganizationComputerGroup["computers"][number]
): void {
	for (const target of computer.ownedComputer?.executionTargets ?? []) {
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
				const agent = agents.get(entry.agentId) ?? {
					agentId: entry.agentId,
					displayName: entry.displayName,
					usageSources: [],
				};
				const limits = target.capabilities.find(
					(capability) =>
						parseAgentControllerRef(capability.agentControllerRef)?.id ===
						entry.agentId
				)?.agentControllerInterface?.usageLimits;
				if (limits?.length) {
					agent.usageSources.push({
						id: `${computer.deviceId}:${target.runtimeLane}`,
						label: computer.deviceDisplayName,
						limits,
					});
				}
				agents.set(entry.agentId, agent);
			}
		}
	}
}

function appendOrganizationComputerLocalAgents(
	agents: Map<string, LocalAgentIdentity>,
	computer: OrganizationComputerGroup["computers"][number]
): void {
	for (const localAgent of computer.localAgents) {
		const parsed = parseAgentControllerRef(localAgent.agentControllerRef);
		if (
			localAgent.enabled &&
			parsed?.kind === "builtin" &&
			hasLocalAgentLogo(parsed.id)
		) {
			const agent = agents.get(parsed.id) ?? {
				agentId: parsed.id,
				displayName: formatLocalAgentDisplayName(parsed.id),
				usageSources: [],
			};
			if (localAgent.details?.usageLimits?.length) {
				agent.usageSources.push({
					id: computer.deviceId,
					label: computer.deviceDisplayName,
					limits: localAgent.details.usageLimits,
				});
			}
			agents.set(parsed.id, agent);
		}
	}
}

function buildLocalAgentSummary(
	localAgents: readonly LocalAgentIdentity[]
): string {
	return localAgents.map((agent) => `${agent.displayName} enabled`).join(", ");
}

// A teammate's card shows a usage ring only when that source is near or at
// its limit; with room to spare it shows no quota at all.
function resolveAttentionUsageSources(
	sources: readonly LocalAgentUsageSource[],
	nowMs: number
) {
	return sources.filter(
		(source) => resolveAgentUsageAttention(source.limits, nowMs) !== null
	);
}
