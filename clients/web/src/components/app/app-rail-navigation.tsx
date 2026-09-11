"use client";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	SidebarGroup as FluidSidebarGroup,
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
	HouseIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import {
	APP_NAV_GROUP_CLASS_NAME,
	APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME,
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { CenterTruncatedText } from "#/components/app/center-truncated-text";
import type { AppOuterRailDestination } from "#/components/app/shell-layout";
import {
	resolveInboxAttentionLabel,
	resolveInboxIndicatorClassName,
} from "#/lib/inbox/attention";
import {
	buildOrganizationDirectMessagesPath,
	buildOrganizationPeoplePath,
	buildOrganizationRootPath,
} from "#/lib/organizations/organization-routes";
import { SidebarDestinationActionSlot } from "./sidebar-destination-actions";

type AppRailDestinationId = AppOuterRailDestination;

type AppRailDestination = {
	attentionTone?: "danger" | "warning" | null;
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
	conversationPath?: string;
	chatUnreadCount?: number;
	chatAttentionTone?: "danger" | "warning" | null;
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
					id: "home",
					label: "Center Agent",
					onIntentPrefetch: input.prefetchCenterAgentConversation,
					unreadCount: input.centerAgentUnreadCount,
					to: buildOrganizationRootPath(input.orgSlug),
					icon: <HouseIcon aria-hidden="true" className="size-5" />,
				},
				{
					id: "directMessages",
					label: "Messenger",
					unreadCount: input.spacesUnreadCount + (input.chatUnreadCount ?? 0),
					attentionTone: input.chatAttentionTone,
					to:
						input.conversationPath ??
						buildOrganizationDirectMessagesPath(input.orgSlug),
					icon: <ChatCircleTextIcon aria-hidden="true" className="size-5" />,
				},
				{
					id: "people",
					label: "Team",
					to: buildOrganizationPeoplePath(input.orgSlug),
					icon: <UsersThreeIcon aria-hidden="true" className="size-5" />,
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
	const { presentation } = useAppNavigationPresentation();
	const navigation = (
		<nav aria-label={input.group.label ?? "Primary navigation"}>
			<SidebarMenu
				activeLayoutId={`main-sidebar-selection-${presentation}`}
				className={input.tier === "icon" ? "gap-1.5" : undefined}
			>
				{input.group.destinations.map((destination) => (
					<AppRailLink
						active={
							destination.id === input.activeDestination ||
							(destination.id === "directMessages" &&
								input.activeDestination === "spaces") ||
							(destination.id === "people" &&
								input.activeDestination === "agents")
						}
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
		input.position > 0 && "mt-4 border-border border-t pt-3"
	);

	return (
		<FluidSidebarGroup className={groupClassName}>
			<SidebarGroupContent>{navigation}</SidebarGroupContent>
		</FluidSidebarGroup>
	);
}

export function CollapsedRailTooltip(input: {
	children: ReactElement;
	disabled?: boolean;
	label: string;
	side?: "top" | "right";
}) {
	return (
		<Tooltip disabled={input.disabled}>
			<TooltipTrigger delay={0} render={input.children} />
			<TooltipContent side={input.side ?? "right"}>
				{input.label}
			</TooltipContent>
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
	if (
		(unreadCount > 0 || input.destination.attentionTone) &&
		unreadIndicatorKind
	) {
		statusIndicator = {
			kind: unreadIndicatorKind,
			tone: input.destination.attentionTone,
		};
	}
	const accessibleLabel = buildAppRailAccessibleLabel({
		attentionCount,
		destinationId: input.destination.id,
		label: [
			input.destination.label,
			resolveInboxAttentionLabel(input.destination.attentionTone),
		]
			.filter(Boolean)
			.join(", "),
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
			{isIcon ? (
				<span className="max-w-full whitespace-normal text-center text-[10px] leading-tight">
					{input.destination.label}
				</span>
			) : (
				<AppRailDestinationLabel
					destination={input.destination}
					statusIndicator={statusIndicator}
					tier={input.tier}
				/>
			)}
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
		isIcon && "h-12 w-full flex-col justify-center gap-1 px-1 py-1",
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

	const Item = SidebarMenuItem;
	const MenuButton = SidebarMenuButton;
	return (
		<Item
			className={isIcon ? "mx-auto h-12 w-full" : "group/destination relative"}
		>
			{isIcon ? (
				<CollapsedRailTooltip label={accessibleLabel}>
					<SidebarMenuButton
						className="h-12"
						isActive={input.active}
						render={link}
					>
						{children}
					</SidebarMenuButton>
				</CollapsedRailTooltip>
			) : (
				<MenuButton isActive={input.active} render={link}>
					{children}
				</MenuButton>
			)}
			{!isIcon &&
				(input.destination.id === "directMessages" ||
					input.destination.id === "home" ||
					input.destination.id === "people" ||
					input.destination.id === "spaces" ||
					input.destination.id === "agents") && (
					<SidebarDestinationActionSlot
						active={input.active}
						destination={input.destination.id}
					/>
				)}
		</Item>
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

type AppRailStatusIndicatorKind =
	| "center-agent-unread"
	| "spaces-unread"
	| "chats-unread";

type AppRailStatusIndicator = {
	tone?: "danger" | "warning" | null;
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
				resolveInboxIndicatorClassName(input.indicator.tone),
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
	if (destinationId === "directMessages") {
		return "chats-unread";
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
