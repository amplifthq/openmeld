"use client";

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
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
	TimerIcon,
	TrayIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { Link, useLocation } from "@tanstack/react-router";
import {
	type ReactElement,
	type ReactNode,
	type RefObject,
	useRef,
} from "react";
import {
	APP_NAV_GROUP_CLASS_NAME,
	APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME,
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { CenterTruncatedText } from "#/components/app/center-truncated-text";
import { ObjectMenuItems } from "#/components/app/object-menu-items";
import type { AppOuterRailDestination } from "#/components/app/shell-layout";
import { InboxAttentionBadge } from "#/components/inbox/inbox-attention-badge";
import type { useInboxAttention } from "#/components/inbox/use-inbox-attention";
import type { SidebarShortcutId } from "#/lib/appearance/sidebar-shortcuts";
import {
	resolveInboxAttentionLabel,
	resolveInboxIndicatorClassName,
} from "#/lib/inbox/attention";
import {
	buildOrganizationInboxPath,
	buildOrganizationPeoplePath,
	buildOrganizationRoutinesPath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { SidebarDestinationActionSlot } from "./sidebar-destination-actions";

type AppRailDestinationId = AppOuterRailDestination | SidebarShortcutId;

type AppRailDestination = {
	accessibleLabel?: string;
	attentionTone?: "danger" | "warning" | null;
	attentionCount?: number;
	icon: ReactNode;
	inboxAttention?: ReturnType<typeof useInboxAttention>;
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
	inboxAttention?: ReturnType<typeof useInboxAttention>;
	chatUnreadCount?: number;
	spacesAttentionTone?: "danger" | "warning" | null;
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
					id: "inbox",
					label: "Inbox",
					accessibleLabel: input.inboxAttention?.label,
					inboxAttention: input.inboxAttention,
					to: buildOrganizationInboxPath(input.orgSlug),
					icon: <TrayIcon aria-hidden="true" className="size-5" />,
				},
				{
					id: "directMessages",
					label: "Spaces",
					unreadCount: input.spacesUnreadCount + (input.chatUnreadCount ?? 0),
					attentionTone: input.spacesAttentionTone,
					to: buildOrganizationSpacesPath(input.orgSlug),
					icon: <ChatCircleTextIcon aria-hidden="true" className="size-5" />,
				},
				{
					id: "people",
					label: "Team",
					to: buildOrganizationPeoplePath(input.orgSlug),
					icon: <UsersThreeIcon aria-hidden="true" className="size-5" />,
				},
				{
					id: "routines",
					label: "Routines",
					to: buildOrganizationRoutinesPath(input.orgSlug),
					icon: <TimerIcon aria-hidden="true" className="size-5" />,
				},
			],
		},
	];
}

export function AppRailNavigationGroup(input: {
	activeDestination: AppRailDestinationId | null;
	group: AppRailGroup;
	position: number;
	standaloneSelection?: boolean;
	pinnedDestinations?: readonly AppRailDestination[];
	renderSectionTrigger?: (
		section: "spaces" | "team",
		trigger: ReactElement
	) => ReactElement;
	tier: SidebarMode;
}) {
	const { presentation } = useAppNavigationPresentation();
	const renderSectionTrigger = input.renderSectionTrigger;
	const renderDestination = (destination: AppRailDestination) => (
		<AppRailLink
			active={
				destination.id === input.activeDestination ||
				(destination.id === "directMessages" &&
					input.activeDestination === "spaces") ||
				(!input.standaloneSelection &&
					destination.id === "people" &&
					input.activeDestination === "agents")
			}
			destination={destination}
			key={destination.id}
			renderTrigger={
				renderSectionTrigger &&
				(destination.id === "people" || destination.id === "directMessages")
					? (trigger) =>
							renderSectionTrigger(
								destination.id === "people" ? "team" : "spaces",
								trigger
							)
					: undefined
			}
			tier={input.tier}
		/>
	);
	const navigation = (
		<nav aria-label={input.group.label ?? "Primary navigation"}>
			<SidebarMenu
				activeLayoutId={
					input.tier === "expanded"
						? `main-sidebar-selection-${presentation}-${input.group.id}`
						: undefined
				}
				className={cn(
					input.tier === "icon" && "gap-1",
					presentation === "drawer" && "gap-2"
				)}
				indicatorTargetSelector={
					input.tier === "icon" ? '[data-slot="app-rail-icon"]' : undefined
				}
			>
				{input.group.destinations.map(renderDestination)}
				{Boolean(input.pinnedDestinations?.length) && (
					<li>
						<div
							aria-hidden="true"
							className="mx-auto my-2 h-px w-5 bg-border"
						/>
						<nav aria-label="Pinned shortcuts">
							<ul className="flex flex-col gap-1">
								{input.pinnedDestinations?.map(renderDestination)}
							</ul>
						</nav>
					</li>
				)}
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
	anchor?: RefObject<Element | null>;
	children: ReactElement;
	contextMenu?: ReactNode;
	disabled?: boolean;
	label: string;
	side?: "top" | "right";
}) {
	return (
		<TooltipProvider delay={0}>
			<Tooltip disabled={input.disabled}>
				{input.contextMenu ? (
					<FluidContextMenu target={<TooltipTrigger render={input.children} />}>
						{input.contextMenu}
					</FluidContextMenu>
				) : (
					<TooltipTrigger render={input.children} />
				)}
				<TooltipContent anchor={input.anchor} side={input.side ?? "right"}>
					{input.label}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

export function AppRailLink(input: {
	active: boolean;
	renderTrigger?: (trigger: ReactElement) => ReactElement;
	destination: AppRailDestination;
	tier: SidebarMode;
}) {
	const { dismiss, presentation } = useAppNavigationPresentation();
	const currentHref = useLocation({
		select: (location) => location.publicHref,
	});
	const isIcon = input.tier === "icon";
	const isDrawer = presentation === "drawer";
	const iconRef = useRef<HTMLSpanElement>(null);

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
	const accessibleLabel =
		input.destination.accessibleLabel ??
		buildAppRailAccessibleLabel({
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
				iconRef={iconRef}
				statusIndicator={statusIndicator}
				tier={input.tier}
			/>
			{isIcon ? (
				<span
					className="max-w-full whitespace-normal text-center text-[10px] leading-tight"
					data-slot="app-rail-label"
				>
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
		isIcon && "h-[3.25rem] w-full flex-col justify-center gap-0.5 px-1 py-0",
		input.tier === "expanded" &&
			!isDrawer &&
			APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME,
		input.tier === "expanded" && !isDrawer && "gap-1.5 ps-[5px]",
		isDrawer && "h-12 w-full gap-3 px-3 text-[15px]",
		input.active && "text-sidebar-accent-foreground"
	);
	const prefetch = input.active
		? undefined
		: input.destination.onIntentPrefetch;
	const link = (
		<Link
			activeOptions={{ exact: true }}
			aria-current={input.active ? "page" : undefined}
			aria-label={accessibleLabel}
			className={className}
			data-app-rail-link
			onClick={(event) => {
				const target = event.currentTarget.getAttribute("target");
				if (
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey ||
					(target && target !== "_self")
				) {
					return;
				}
				// Repeating the current destination must not reload the auth boundary.
				if (event.currentTarget.getAttribute("href") === currentHref) {
					event.preventDefault();
				}
				dismiss();
			}}
			onFocus={prefetch}
			onPointerEnter={prefetch}
			to={input.destination.to}
		>
			{children}
		</Link>
	);

	if (input.renderTrigger) {
		return (
			<SidebarMenuItem
				className={
					isIcon ? "mx-auto h-[3.25rem] w-full" : "group/destination relative"
				}
				data-app-rail-item
			>
				{input.renderTrigger(
					<SidebarMenuButton isActive={input.active} render={link}>
						{children}
					</SidebarMenuButton>
				)}
				<RailDestinationActions {...input} />
			</SidebarMenuItem>
		);
	}
	if (isIcon) {
		return (
			<SidebarMenuItem
				className="mx-auto h-[3.25rem] w-full"
				data-app-rail-item
			>
				<CollapsedRailTooltip
					anchor={iconRef}
					contextMenu={<ObjectMenuItems href={input.destination.to} />}
					label={accessibleLabel}
				>
					<SidebarMenuButton isActive={input.active} render={link}>
						{children}
					</SidebarMenuButton>
				</CollapsedRailTooltip>
			</SidebarMenuItem>
		);
	}

	return (
		<SidebarMenuItem className="group/destination relative">
			<FluidContextMenu
				target={
					<SidebarMenuButton isActive={input.active} render={link}>
						{children}
					</SidebarMenuButton>
				}
			>
				<ObjectMenuItems href={input.destination.to} />
			</FluidContextMenu>
			<RailDestinationActions {...input} />
		</SidebarMenuItem>
	);
}

function RailDestinationActions(input: {
	active: boolean;
	destination: AppRailDestination;
	tier: SidebarMode;
}) {
	const id = input.destination.id;
	if (
		input.tier !== "expanded" ||
		!(
			id === "directMessages" ||
			id === "home" ||
			id === "people" ||
			id === "spaces" ||
			id === "agents"
		)
	) {
		return null;
	}
	return (
		<SidebarDestinationActionSlot active={input.active} destination={id} />
	);
}

function AppRailDestinationIcon(input: {
	attentionCount: number;
	destination: AppRailDestination;
	iconRef: RefObject<HTMLSpanElement | null>;
	statusIndicator: AppRailStatusIndicator | null;
	tier: SidebarMode;
}) {
	return (
		<span
			className={cn(
				"relative flex shrink-0 items-center justify-center rounded-md",
				input.tier === "icon" ? "size-9" : "size-5"
			)}
			data-slot={input.tier === "icon" ? "app-rail-icon" : undefined}
			ref={input.iconRef}
		>
			{input.destination.icon}
			{input.destination.inboxAttention && input.tier === "icon" ? (
				<InboxAttentionBadge {...input.destination.inboxAttention} />
			) : null}
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
			{input.destination.inboxAttention && input.tier === "expanded" ? (
				<InboxAttentionBadge
					{...input.destination.inboxAttention}
					placement="trailing"
				/>
			) : null}
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
					? "absolute -end-1.5 -top-1.5 h-4 min-w-4 px-1 text-[9px] shadow-sm"
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
				input.placement === "overlay" && "absolute end-1 top-1"
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
	return input.count === 1 ? "update" : "updates";
}
