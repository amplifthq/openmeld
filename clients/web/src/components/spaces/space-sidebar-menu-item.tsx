"use client";

import { WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE } from "@openmeld/schemas";
import type {
	AccountSpaceActiveWakeSummaryItem,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { SidebarMenuAction } from "@openmeld/ui/fluid/sidebar-menu";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
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
import {
	resolveWakeProgressStatus,
	WAKE_PROGRESS_STATUS_PRIORITY,
	type WakeProgressStatusPresentation,
} from "#/lib/spaces/wake-progress-status";
import { resolveAccountSpaceTrailingStatus } from "./account-space-sections";
import { SpaceAgentOrb } from "./space-agent-orb";
import {
	type SpaceAgentOrbState,
	WAKE_STATUS_ORB_STATE,
} from "./space-agent-orb-state";

const LEADING_MENTION_MARKER_PATTERN = /^@+/;
const SPACE_SIDEBAR_PERSISTENT_STATUS_CLASS_NAME =
	"pointer-events-none absolute top-1 right-1 z-10 inline-flex size-7 items-center justify-center";
export type SpaceSidebarActiveWakeSummary =
	AccountSpaceActiveWakeSummaryItem & {
		waitReasonCode?: WakeProgressItem["waitReasonCode"];
		statuses?: readonly WakeProgressStatusPresentation[];
		hasMore?: boolean;
	};
export function SpaceSidebarMenuItem(input: {
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
	lastJoinedAtFormatter: Intl.DateTimeFormat;
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
					"@container/space-item relative flex min-h-9 min-w-0 items-stretch focus-within:text-sidebar-accent-foreground",
					APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
					APP_NAV_ITEM_TONE_CLASS_NAME,
					input.isActive ? "font-medium text-sidebar-accent-foreground" : null
				)}
				data-active={input.isActive}
			>
				<Tooltip>
					<TooltipTrigger
						render={
							<Link
								{...input.drag?.rowProps}
								aria-label={openLabel}
								className={resolveSpaceSidebarOpenButtonClassName({
									hasUnread,
								})}
								resetScroll={false}
								to={input.routePath}
							>
								<HashIcon data-icon="inline-start" data-space-icon="channel" />
								<div
									className="flex min-w-0 flex-1 items-center gap-px"
									data-slot="space-sidebar-name-and-date"
								>
									<CenterTruncatedText
										className={cn(
											"min-w-0 flex-1",
											trailingStatus === "working" ||
												trailingStatus === "unread"
												? "pr-16"
												: "pr-8"
										)}
										text={input.item.spaceName}
									/>
									{trailingStatus === null ? (
										<span
											className="@[13rem]/space-item:inline-flex hidden shrink-0 text-muted-foreground text-xs opacity-100 transition-opacity group-focus-within/space-row:opacity-0 group-hover/space-row:opacity-0"
											data-slot="space-sidebar-date"
										>
											{formatLastJoinedAt(
												input.item.lastJoinedAt,
												input.lastJoinedAtFormatter
											)}
										</span>
									) : null}
								</div>
								{trailingStatus === "unread" ? (
									<span
										aria-hidden="true"
										className={SPACE_SIDEBAR_PERSISTENT_STATUS_CLASS_NAME}
										data-space-unread-indicator="true"
									>
										<span
											className={cn(
												"size-1.5 rounded-full",
												resolveStatusToneIndicatorClassName("warning", "quiet")
											)}
										/>
									</span>
								) : null}
							</Link>
						}
					/>
					<TooltipContent
						align="start"
						className="max-w-sm flex-col items-start whitespace-normal text-left leading-5"
						side="right"
					>
						<span className="font-medium">{input.item.spaceName}</span>
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
					<TooltipContent side="right">
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
						<SpaceAgentOrb
							paused={input.presentation.orbState === undefined}
							state={input.presentation.orbState ?? "listening"}
						/>
					</button>
				}
			/>
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	);
}

function resolveSpaceSidebarOpenButtonClassName(input: {
	hasUnread: boolean;
}): string {
	return cn(
		"flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left outline-none",
		input.hasUnread ? "font-semibold text-sidebar-foreground" : null
	);
}

export function buildSpaceActiveWakeSummary(input: {
	fallbackSummary?: AccountSpaceActiveWakeSummaryItem;
	items: readonly WakeProgressItem[];
	spaceId: string;
}): SpaceSidebarActiveWakeSummary {
	const fallbackNamesByProfileId = new Map(
		(input.fallbackSummary?.activeTargets ?? []).map((target) => [
			target.profileId,
			target.profileName,
		])
	);
	const targetsByProfileId = new Map<
		string,
		{ activeWakeCount: number; profileName: string | null }
	>();
	const activeItems = input.items.filter((item) => !item.terminal);
	for (const item of activeItems) {
		const current = targetsByProfileId.get(item.targetProfileId);
		targetsByProfileId.set(item.targetProfileId, {
			activeWakeCount: (current?.activeWakeCount ?? 0) + 1,
			profileName:
				current?.profileName ??
				fallbackNamesByProfileId.get(item.targetProfileId) ??
				normalizeWorkingTargetLabel(item.targetLabel) ??
				null,
		});
	}
	const activeTargets = Array.from(
		targetsByProfileId,
		([profileId, target]) => ({ profileId, ...target })
	);
	return {
		activeTargets,
		statuses: [...activeItems]
			.sort((left, right) => (left.startedAtMs ?? 0) - (right.startedAtMs ?? 0))
			.flatMap((item) => {
				const status = resolveWakeProgressStatus({
					...item,
					targetLabel:
						normalizeWorkingTargetLabel(item.targetLabel) ??
						fallbackNamesByProfileId.get(item.targetProfileId) ??
						"Agent",
				});
				return status ? [status] : [];
			}),
		activeWakeCount: activeTargets.reduce(
			(total, target) => total + target.activeWakeCount,
			0
		),
		spaceId: input.spaceId,
		waitReasonCode:
			activeItems.length > 0 &&
			activeItems.every(
				(item) =>
					item.waitReasonCode ===
					WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
			)
				? WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
				: null,
	};
}

type SpaceActiveWakePresentation = {
	isWaitingForCurrentTask: boolean;
	label: string;
	orbState?: SpaceAgentOrbState;
};

function resolveSpaceActiveWakePresentation(
	summary: SpaceSidebarActiveWakeSummary
): SpaceActiveWakePresentation {
	if (summary.statuses?.length) {
		const statuses = [...summary.statuses].sort(
			(left, right) =>
				WAKE_PROGRESS_STATUS_PRIORITY[left.kind] -
				WAKE_PROGRESS_STATUS_PRIORITY[right.kind]
		);
		const first = statuses[0];
		if (first) {
			return {
				isWaitingForCurrentTask: first.kind === "waiting_for_controller",
				label: [
					...new Set(statuses.map((status) => status.label)),
					...(summary.hasMore ? ["More active tasks in this Space"] : []),
				].join("; "),
				orbState: WAKE_STATUS_ORB_STATE[first.kind],
			};
		}
	}
	const isWaitingForCurrentTask =
		summary.waitReasonCode ===
		WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE;
	const activeTargets = summary.activeTargets ?? [];
	if (activeTargets.length > 0) {
		return {
			isWaitingForCurrentTask,
			label: resolveAttributedSpaceWakeStatusLabel({
				activeTargets,
				isWaitingForCurrentTask,
			}),
		};
	}
	return {
		isWaitingForCurrentTask,
		label: resolveGenericSpaceWakeStatusLabel({
			activeWakeCount: summary.activeWakeCount,
			isWaitingForCurrentTask,
		}),
	};
}

function resolveGenericSpaceWakeStatusLabel(input: {
	activeWakeCount: number;
	isWaitingForCurrentTask: boolean;
}): string {
	if (input.isWaitingForCurrentTask) {
		return input.activeWakeCount === 1
			? "An agent is waiting for its current task"
			: `${String(input.activeWakeCount)} Wakes are waiting for current tasks`;
	}
	return input.activeWakeCount === 1
		? "A Wake is active"
		: `${String(input.activeWakeCount)} Wakes are active`;
}

function resolveAttributedSpaceWakeStatusLabel(input: {
	activeTargets: NonNullable<SpaceSidebarActiveWakeSummary["activeTargets"]>;
	isWaitingForCurrentTask: boolean;
}): string {
	const namedTargets = input.activeTargets.filter(
		(target): target is typeof target & { profileName: string } =>
			target.profileName !== null
	);
	const unknownTargetCount = input.activeTargets.length - namedTargets.length;
	const targetLabels = namedTargets.map((target) => target.profileName);
	if (unknownTargetCount === 1) {
		targetLabels.push("another agent");
	} else if (unknownTargetCount > 1) {
		targetLabels.push(`${String(unknownTargetCount)} other agents`);
	}
	const plural = input.activeTargets.length > 1;
	const status = input.isWaitingForCurrentTask
		? `${plural ? "are" : "is"} waiting for ${plural ? "their" : "its"} current task`
		: `${plural ? "have" : "has"} an active Wake`;
	return capitalizeStatusFragment(
		`${formatEnglishList(targetLabels)} ${status}`
	);
}

function formatEnglishList(values: readonly string[]): string {
	if (values.length <= 1) {
		return values[0] ?? "";
	}
	if (values.length === 2) {
		return `${values[0]} and ${values[1]}`;
	}
	return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function capitalizeStatusFragment(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function normalizeWorkingTargetLabel(value: string): string | null {
	const normalized = value
		.trim()
		.replace(LEADING_MENTION_MARKER_PATTERN, "")
		.trim();
	return normalized.length > 0 && !normalized.startsWith("agt_")
		? normalized
		: null;
}

function formatLastJoinedAt(
	value: string,
	formatter: Intl.DateTimeFormat
): string {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		return "";
	}

	return formatter.format(timestamp);
}
