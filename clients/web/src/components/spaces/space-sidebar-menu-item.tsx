"use client";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import {
	SidebarMenuAction,
	SidebarMenuButton,
} from "@openmeld/ui/fluid/sidebar-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { HashIcon, PushPinIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ComponentProps, CSSProperties, Ref } from "react";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { CenterTruncatedText } from "#/components/app/center-truncated-text";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { resolveAccountSpaceTrailingStatus } from "./account-space-sections";
import {
	resolveConversationTimestamp,
	SidebarConversationTime,
} from "./sidebar-conversation-time";
import { SpaceActiveWakeIndicator } from "./space-active-wake-indicator";
import {
	resolveSpaceActiveWakePresentation,
	type SpaceActiveWakePresentation,
	type SpaceSidebarActiveWakeSummary,
} from "./space-active-wake-presentation";
import {
	type SpaceMemberAppearance,
	SpaceMemberAvatars,
} from "./space-member-avatars";

const SPACE_SIDEBAR_PERSISTENT_STATUS_CLASS_NAME =
	"pointer-events-none absolute top-1 right-1 z-10 inline-flex size-7 items-center justify-center";
export function SpaceSidebarMenuItem(input: {
	memberAppearances?: ReadonlyMap<string, SpaceMemberAppearance>;
	drag?: {
		ref: Ref<HTMLLIElement>;
		style: CSSProperties;
		rowProps: ComponentProps<"a">;
	};
	activeWakeSummary?: SpaceSidebarActiveWakeSummary;
	index: number;
	isActive: boolean;
	isPinPending: boolean;
	item: AccountSpaceItem;
	onOpenSpace: (routePath: string) => void;
	onTogglePinned: (item: AccountSpaceItem) => void;
	routePath: string;
	unreadCount: number;
}) {
	const isPinned = input.item.pinnedAt !== null;
	const hasActiveWake = input.activeWakeSummary !== undefined;
	const activeWakePresentation = input.activeWakeSummary
		? resolveSpaceActiveWakePresentation(input.activeWakeSummary)
		: null;
	const pinLabel = isPinned
		? `Unpin ${input.item.spaceName}`
		: `Pin ${input.item.spaceName}`;
	const hasUnread = input.unreadCount > 0;
	const trailingStatus = resolveAccountSpaceTrailingStatus({
		hasActiveWake,
		hasUnread,
		isPinned,
	});
	const openLabel = buildSpaceSidebarOpenLabel({
		hasActiveWake,
		hasUnread,
		isWaitingForCurrentTask:
			activeWakePresentation?.isWaitingForCurrentTask ?? false,
		spaceName: input.item.spaceName,
	});
	const timestamp = resolveConversationTimestamp(
		input.item.messagePreview?.timestamp,
		input.item.spaceCreatedAt
	);
	return (
		<FluidNavMenuItem
			className="group/space-row"
			index={input.index}
			ref={input.drag?.ref}
			style={input.drag?.style}
			value={input.item.spaceId}
		>
			<div
				className={cn(
					"@container/conversation-row relative flex min-h-9 min-w-0 items-stretch focus-within:text-sidebar-accent-foreground",
					APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
					APP_NAV_ITEM_TONE_CLASS_NAME,
					input.isActive ? "font-medium text-sidebar-accent-foreground" : null
				)}
				data-active={input.isActive}
			>
				<Tooltip>
					<TooltipTrigger
						render={
							<SidebarMenuButton
								asChild
								className="h-auto flex-1"
								isActive={input.isActive}
							>
								<Link
									{...input.drag?.rowProps}
									aria-label={openLabel}
									className={resolveSpaceSidebarOpenButtonClassName({
										hasUnread,
									})}
									resetScroll={false}
									to={input.routePath}
								>
									{input.item.memberPreviews?.length ? (
										<SpaceMemberAvatars
											appearances={input.memberAppearances}
											members={input.item.memberPreviews}
										/>
									) : (
										<HashIcon
											data-icon="inline-start"
											data-space-icon="channel"
										/>
									)}
									<div
										className="flex min-w-0 flex-1 items-center gap-px"
										data-slot="space-sidebar-name-and-date"
									>
										<CenterTruncatedText
											className={cn(
												"min-w-0 flex-1",
												trailingStatus === "working" ||
													trailingStatus === "unread"
													? "pr-8"
													: null
											)}
											text={input.item.spaceName}
										/>
										{!(hasActiveWake || hasUnread) && timestamp !== null ? (
											<SidebarConversationTime
												className="group-focus-within/space-row:opacity-0 group-hover/space-row:opacity-0"
												timestamp={timestamp}
											/>
										) : null}
									</div>
									{trailingStatus === "unread" ? (
										<span
											aria-hidden="true"
											className={SPACE_SIDEBAR_PERSISTENT_STATUS_CLASS_NAME}
											data-space-unread-indicator="true"
										>
											<span className={cn("status-dot", "bg-unread")} />
										</span>
									) : null}
								</Link>
							</SidebarMenuButton>
						}
					/>
					<TooltipContent
						align="start"
						className="max-w-sm flex-col items-start whitespace-normal text-left leading-5"
						side="right"
					>
						<span className="font-medium">{input.item.spaceName}</span>
						{input.item.activeMemberCount !== null && (
							<span>
								{input.item.activeMemberCount}{" "}
								{input.item.activeMemberCount === 1 ? "member" : "members"}
							</span>
						)}
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger
						render={
							<SidebarMenuAction
								aria-label={pinLabel}
								aria-pressed={isPinned}
								className={cn(
									"top-1.5 disabled:pointer-events-none disabled:opacity-40 group-focus-within/space-row:opacity-100 group-hover/space-row:opacity-100 [@media(hover:none)]:opacity-100",
									trailingStatus === "working" || trailingStatus === "unread"
										? "right-9"
										: "right-1.5",
									isPinned ? "text-foreground" : null
								)}
								disabled={input.isPinPending}
								onClick={(event) => {
									event.stopPropagation();
									input.onTogglePinned(input.item);
								}}
								showOnHover
								type="button"
							>
								<PushPinIcon
									className="size-4"
									weight={isPinned ? "fill" : "regular"}
								/>
							</SidebarMenuAction>
						}
					/>
					<TooltipContent side="top">
						{isPinned ? "Unpin space" : "Pin space"}
					</TooltipContent>
				</Tooltip>

				<SpaceSidebarActiveWakeStatus
					enabled={trailingStatus === "working"}
					onOpen={() => input.onOpenSpace(input.routePath)}
					presentation={activeWakePresentation}
					spaceName={input.item.spaceName}
				/>
			</div>
		</FluidNavMenuItem>
	);
}

function buildSpaceSidebarOpenLabel(input: {
	hasActiveWake: boolean;
	hasUnread: boolean;
	isWaitingForCurrentTask: boolean;
	spaceName: string;
}): string {
	const statuses = [
		input.hasUnread ? "unread messages" : null,
		resolveSpaceSidebarActiveWakeLabel(input),
	].filter(Boolean);
	return statuses.length > 0
		? `${input.spaceName}, ${statuses.join(", ")}`
		: input.spaceName;
}

function resolveSpaceSidebarActiveWakeLabel(input: {
	hasActiveWake: boolean;
	isWaitingForCurrentTask: boolean;
}): string | null {
	if (!input.hasActiveWake) {
		return null;
	}
	return input.isWaitingForCurrentTask ? "agent waiting" : "active Wake";
}

function SpaceSidebarActiveWakeStatus(input: {
	enabled: boolean;
	onOpen: () => void;
	presentation: SpaceActiveWakePresentation | null;
	spaceName: string;
}) {
	if (!(input.enabled && input.presentation)) {
		return null;
	}
	const { isWaitingForCurrentTask, label } = input.presentation;
	return (
		<Tooltip>
			<TooltipTrigger
				delay={0}
				render={
					<button
						aria-label={`${label}. Open ${input.spaceName}`}
						className={cn(
							SPACE_SIDEBAR_PERSISTENT_STATUS_CLASS_NAME,
							"pointer-events-auto rounded-full outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
							isWaitingForCurrentTask ? "text-muted-foreground" : null
						)}
						data-space-active-wake-orb={
							isWaitingForCurrentTask ? undefined : "true"
						}
						data-space-active-wake-waiting={
							isWaitingForCurrentTask ? "true" : undefined
						}
						onClick={input.onOpen}
						type="button"
					>
						<SpaceActiveWakeIndicator presentation={input.presentation} />
					</button>
				}
			/>
			<TooltipContent side="top">{label}</TooltipContent>
		</Tooltip>
	);
}

function resolveSpaceSidebarOpenButtonClassName(input: {
	hasUnread: boolean;
}): string {
	return cn(
		"flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 text-left outline-none",
		input.hasUnread ? "font-semibold text-sidebar-foreground" : null
	);
}
