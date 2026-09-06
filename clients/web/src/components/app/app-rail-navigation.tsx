"use client";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	SidebarGroup as FluidSidebarGroup,
	SidebarGroupLabel as FluidSidebarGroupLabel,
	SidebarGroupContent,
} from "@openmeld/ui/fluid/sidebar-group";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@openmeld/ui/fluid/sidebar-menu";
import type { SidebarMode } from "@openmeld/ui/fluid/sidebar-state";
import { resolveStatusToneCompactBadgeClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ChatCircleTextIcon,
	HashIcon,
	HouseIcon,
	PlusIcon,
	RobotIcon,
	UserIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import {
	APP_NAV_GROUP_CLASS_NAME,
	APP_NAV_GROUP_LABEL_CLASS_NAME,
	APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME,
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { CenterTruncatedText } from "#/components/app/center-truncated-text";
import type { AppOuterRailDestination } from "#/components/app/shell-layout";
import {
	buildOrganizationAgentCreationPath,
	buildOrganizationAgentsPath,
	buildOrganizationDirectMessagesPath,
	buildOrganizationPeoplePath,
	buildOrganizationRootPath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { useAppSidebarGroupState } from "./app-sidebar-group";
import { SidebarDestinationActionSlot } from "./sidebar-destination-actions";

type AppRailDestinationId = AppOuterRailDestination;

type AppRailDestination = {
	attentionCount?: number;
	icon: ReactNode;
	id: AppRailDestinationId;
	label: string;
	onIntentPrefetch?: () => void;
	to: string;
	unreadCount?: number;
};

type AppRailGroup = {
	destinations: readonly AppRailDestination[];
	id: string;
	label: string | null;
};

export function buildAppRailGroups(input: {
	orgSlug: string;
	centerAgentUnreadCount: number;
	prefetchCenterAgentConversation: () => void;
	spacesUnreadCount: number;
}): readonly AppRailGroup[] {
	return [
		{
			id: "primary",
			label: null,
			destinations: [
				{
					id: "newAgent",
					label: "New Agent",
					to: buildOrganizationAgentCreationPath(input.orgSlug),
					icon: <PlusIcon aria-hidden="true" className="size-4" />,
				},
				{
					id: "home",
					label: "Home",
					onIntentPrefetch: input.prefetchCenterAgentConversation,
					to: buildOrganizationRootPath(input.orgSlug),
					icon: <HouseIcon aria-hidden="true" className="size-4" />,
					unreadCount: input.centerAgentUnreadCount,
				},
				{
					id: "spaces",
					label: "Spaces",
					to: buildOrganizationSpacesPath(input.orgSlug),
					unreadCount: input.spacesUnreadCount,
					icon: (
						<HashIcon
							aria-hidden="true"
							className="size-4"
							data-space-icon="channel"
						/>
					),
				},
				{
					id: "directMessages",
					label: "Messages",
					to: buildOrganizationDirectMessagesPath(input.orgSlug),
					icon: <ChatCircleTextIcon aria-hidden="true" className="size-4" />,
				},
			],
		},
		{
			id: "team",
			label: "Team",
			destinations: [
				{
					id: "people",
					label: "People",
					to: buildOrganizationPeoplePath(input.orgSlug),
					icon: <UserIcon aria-hidden="true" className="size-4" />,
				},
				{
					id: "agents",
					label: "Agents",
					to: buildOrganizationAgentsPath(input.orgSlug),
					icon: <RobotIcon aria-hidden="true" className="size-4" />,
				},
			],
		},
	];
}

export function AppRailNavigationGroup(input: {
	activeDestination: AppOuterRailDestination | null;
	group: AppRailGroup;
	position: number;
	tier: SidebarMode;
}) {
	const groupState = useAppSidebarGroupState();
	const selectedDestination = input.group.destinations.find(
		(destination) => destination.id === input.activeDestination
	);
	const { presentation } = useAppNavigationPresentation();
	const navigation = (
		<nav aria-label={input.group.label ?? "Primary navigation"}>
			<SidebarMenu activeLayoutId={`main-sidebar-selection-${presentation}`}>
				{input.group.destinations.map((destination) => (
					<AppRailLink
						active={destination.id === input.activeDestination}
						destination={destination}
						key={destination.id}
						tier={input.tier}
					/>
				))}
			</SidebarMenu>
		</nav>
	);
	const groupClassName = cn(
		APP_NAV_GROUP_CLASS_NAME,
		input.position > 0 && "mt-1"
	);

	if (input.tier === "expanded" && input.group.label) {
		return (
			<FluidSidebarGroup
				className={cn(groupClassName, "gap-0")}
				collapsible
				data-sidebar-group-id={input.group.id}
				onOpenChange={(open) => groupState?.setOpen(input.group.id, open)}
				open={groupState?.isOpen(input.group.id) ?? true}
			>
				<FluidSidebarGroupLabel
					aria-label={input.group.label}
					className={cn(APP_NAV_GROUP_LABEL_CLASS_NAME, "ps-1.5")}
					collapsedContent={
						selectedDestination ? (
							<span
								className="ml-1 flex min-w-0 items-center gap-1.5 text-sidebar-foreground"
								data-slot="collapsed-group-selection"
							>
								<span className="flex shrink-0 [&_svg]:size-3.5">
									{selectedDestination.icon}
								</span>
								<span className="truncate">{selectedDestination.label}</span>
							</span>
						) : undefined
					}
				>
					{input.group.label}
				</FluidSidebarGroupLabel>
				{navigation}
			</FluidSidebarGroup>
		);
	}

	return (
		<FluidSidebarGroup className={groupClassName}>
			<SidebarGroupContent>{navigation}</SidebarGroupContent>
		</FluidSidebarGroup>
	);
}

export function CollapsedRailTooltip(input: {
	children: ReactElement;
	label: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger delay={0} render={input.children} />
			<TooltipContent side="right">{input.label}</TooltipContent>
		</Tooltip>
	);
}

export function AppRailLink(input: {
	active: boolean;
	destination: AppRailDestination;
	tier: SidebarMode;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const isIcon = input.tier === "icon";

	const attentionCount = Math.max(0, input.destination.attentionCount ?? 0);
	const unreadCount = Math.max(0, input.destination.unreadCount ?? 0);
	let statusIndicator: AppRailStatusIndicator | null = null;
	const unreadIndicatorKind = resolveAppRailUnreadIndicatorKind(
		input.destination.id
	);
	if (unreadCount > 0 && unreadIndicatorKind) {
		statusIndicator = {
			kind: unreadIndicatorKind,
		};
	}
	const accessibleLabel = buildAppRailAccessibleLabel({
		attentionCount,
		destinationId: input.destination.id,
		label: input.destination.label,
		unreadCount,
	});
	const children = (
		<>
			<AppRailDestinationIcon
				attentionCount={attentionCount}
				destination={input.destination}
				statusIndicator={statusIndicator}
				tier={input.tier}
			/>
			<AppRailDestinationLabel
				destination={input.destination}
				statusIndicator={statusIndicator}
				tier={input.tier}
			/>
			<AppRailTrailingAttentionBadge
				attentionCount={attentionCount}
				tier={input.tier}
			/>
		</>
	);
	const className = cn(
		"flex min-w-0 items-center border border-transparent outline-none focus-visible:text-sidebar-accent-foreground",
		APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
		APP_NAV_ITEM_TONE_CLASS_NAME,
		isIcon && "size-9 justify-center px-0",
		input.tier === "expanded" && APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME,
		input.tier === "expanded" && "gap-1.5 ps-[5px]",
		input.active && "text-sidebar-accent-foreground"
	);
	const link = (
		<Link
			activeOptions={{ exact: true }}
			aria-current={input.active ? "page" : undefined}
			aria-label={accessibleLabel}
			className={className}
			onClick={(event) => {
				if (
					!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
				) {
					dismiss();
				}
			}}
			onFocus={input.active ? undefined : input.destination.onIntentPrefetch}
			onPointerEnter={
				input.active ? undefined : input.destination.onIntentPrefetch
			}
			to={input.destination.to}
		>
			{children}
		</Link>
	);

	return (
		<SidebarMenuItem
			className={isIcon ? "mx-auto size-9" : "group/destination relative"}
		>
			{isIcon ? (
				<CollapsedRailTooltip label={accessibleLabel}>
					<SidebarMenuButton isActive={input.active} render={link}>
						{children}
					</SidebarMenuButton>
				</CollapsedRailTooltip>
			) : (
				<SidebarMenuButton isActive={input.active} render={link}>
					{children}
				</SidebarMenuButton>
			)}
			{!isIcon &&
				(input.destination.id === "people" ||
					input.destination.id === "agents") && (
					<SidebarDestinationActionSlot destination={input.destination.id} />
				)}
		</SidebarMenuItem>
	);
}

function AppRailDestinationIcon(input: {
	attentionCount: number;
	destination: AppRailDestination;
	statusIndicator: AppRailStatusIndicator | null;
	tier: SidebarMode;
}) {
	return (
		<span className="relative flex size-4 shrink-0 items-center justify-center">
			{input.destination.icon}
			{input.statusIndicator && input.tier !== "expanded" ? (
				<AppRailStatusDot
					indicator={input.statusIndicator}
					placement="overlay"
				/>
			) : null}
			{input.attentionCount > 0 && input.tier !== "expanded" ? (
				<AppRailAttentionBadge
					count={input.attentionCount}
					placement="overlay"
				/>
			) : null}
		</span>
	);
}

function AppRailDestinationLabel(input: {
	destination: AppRailDestination;
	statusIndicator: AppRailStatusIndicator | null;
	tier: SidebarMode;
}) {
	if (input.tier === "icon") {
		return null;
	}
	return (
		<span
			className={cn(
				"inline-flex min-w-0 items-center gap-1.5",
				input.tier === "expanded" && "flex-1"
			)}
		>
			<CenterTruncatedText text={input.destination.label} />
			{input.statusIndicator && input.tier === "expanded" ? (
				<AppRailStatusDot
					indicator={input.statusIndicator}
					placement="trailing"
				/>
			) : null}
		</span>
	);
}

function AppRailTrailingAttentionBadge(input: {
	attentionCount: number;
	tier: SidebarMode;
}) {
	return input.attentionCount > 0 && input.tier === "expanded" ? (
		<AppRailAttentionBadge count={input.attentionCount} placement="trailing" />
	) : null;
}

function AppRailAttentionBadge(input: {
	count: number;
	placement: "overlay" | "trailing";
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex items-center justify-center rounded-full border font-semibold tabular-nums leading-none",
				input.placement === "overlay"
					? "absolute -end-2 -top-2 h-4 min-w-4 px-1 text-[9px] shadow-sm"
					: "ms-auto h-5 min-w-5 px-1.5 text-[10px]",
				resolveStatusToneCompactBadgeClassName("warning")
			)}
		>
			{input.count > 99 ? "99+" : input.count}
		</span>
	);
}

type AppRailStatusIndicatorKind = "center-agent-unread" | "spaces-unread";

type AppRailStatusIndicator = {
	kind: AppRailStatusIndicatorKind;
};

function AppRailStatusDot(input: {
	indicator: AppRailStatusIndicator;
	placement: "overlay" | "trailing";
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"status-dot",
				"bg-unread",
				input.placement === "overlay" && "absolute -end-1.5 -top-1.5"
			)}
			data-app-rail-status-indicator={input.indicator.kind}
			data-app-rail-status-placement={input.placement}
		/>
	);
}

function buildAppRailAccessibleLabel(input: {
	attentionCount: number;
	destinationId: AppRailDestinationId;
	label: string;
	unreadCount: number;
}): string {
	if (input.unreadCount > 0) {
		const unreadCopy = resolveAppRailUnreadCopy({
			count: input.unreadCount,
			destinationId: input.destinationId,
		});
		return `${input.label}, ${input.unreadCount} unread ${unreadCopy}`;
	}
	if (input.attentionCount === 0) {
		return input.label;
	}
	const itemCopy = input.attentionCount === 1 ? "item needs" : "items need";
	return `${input.label}, ${input.attentionCount} ${itemCopy} your attention`;
}

function resolveAppRailUnreadIndicatorKind(
	destinationId: AppRailDestinationId
): AppRailStatusIndicatorKind | null {
	if (destinationId === "home") {
		return "center-agent-unread";
	}
	if (destinationId === "spaces") {
		return "spaces-unread";
	}
	return null;
}

function resolveAppRailUnreadCopy(input: {
	count: number;
	destinationId: AppRailDestinationId;
}): string {
	if (input.destinationId === "home") {
		return input.count === 1 ? "reply" : "replies";
	}
	return input.count === 1 ? "message" : "messages";
}
