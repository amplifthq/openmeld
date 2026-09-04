"use client";

import { WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE } from "@openmeld/schemas";
import type {
	AccountSpaceActiveWakeSummaryItem,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	hasVisibleActiveWakeProgress,
	mergeWakeProgressItems,
} from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CompassIcon,
	HashIcon,
	HourglassMediumIcon,
	PlusIcon,
	PushPinIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
	type AppContextualNavGroup,
	AppContextualSidebarNav,
} from "#/components/app/app-contextual-layout";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { CenterTruncatedText } from "#/components/app/center-truncated-text";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationNewSpacePath,
	buildOrganizationSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import type {
	AccountSpaceItem,
	AccountSpaceSections,
} from "#/lib/spaces/account-spaces";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	spaceActiveWakeProgressSummaryQueryOptions,
	spaceWakeProgressPresentationQueryOptions,
} from "#/query/spaces/active-wake-progress";
import {
	isNewlyJoinedAccountSpace,
	prioritizeNewlyJoinedAccountSpaces,
	resolveAccountSpaceTrailingStatus,
	type SpaceUnreadById,
	selectAccountSpaceSections,
} from "./account-space-sections";
import { SpaceAgentOrb } from "./space-agent-orb";
import { useSpaceWakeProgressVisibleProjection } from "./space-wake-progress-visible-projection";
import { useAccountSpaceIndicators } from "./use-account-space-indicators";
import { useAccountSpacePinMutation } from "./use-account-space-pin-mutation";

const SIDEBAR_TIME_FORMAT_OPTIONS = {
	day: "numeric",
	month: "short",
} as const;
const UTC_SIDEBAR_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	...SIDEBAR_TIME_FORMAT_OPTIONS,
	timeZone: "UTC",
});
const BROWSER_SIDEBAR_TIME_ZONE =
	typeof window === "undefined"
		? "UTC"
		: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const BROWSER_SIDEBAR_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	...SIDEBAR_TIME_FORMAT_OPTIONS,
	timeZone: BROWSER_SIDEBAR_TIME_ZONE,
});
const LEADING_MENTION_MARKER_PATTERN = /^@+/;

const EMPTY_ACCOUNT_SPACE_SECTIONS: AccountSpaceSections = {
	pinnedItems: [],
	recentlyDeletedItems: [],
	spaceItems: [],
};

const DELETED_SPACE_NOTICE_STORAGE_KEY = "openmeld:deleted-space-notices-shown";
const SPACE_SIDEBAR_PERSISTENT_STATUS_CLASS_NAME =
	"pointer-events-none absolute top-1 right-1 z-10 inline-flex size-7 items-center justify-center transition-transform duration-150 ease-out group-focus-within/space-row:translate-x-3 group-focus-within/space-row:-translate-y-3 group-hover/space-row:translate-x-3 group-hover/space-row:-translate-y-3 motion-reduce:transition-none";

type SpaceSidebarActiveWakeSummary = AccountSpaceActiveWakeSummaryItem & {
	waitReasonCode?: WakeProgressItem["waitReasonCode"];
};

function subscribeToBrowserEnvironment() {
	return () => undefined;
}

function getBrowserEnvironmentSnapshot(): true {
	return true;
}

function getServerEnvironmentSnapshot(): false {
	return false;
}

function readShownDeletedSpaceNotices(): Set<string> {
	if (typeof window === "undefined") {
		return new Set();
	}
	try {
		const raw = window.localStorage.getItem(DELETED_SPACE_NOTICE_STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : [];
		return new Set(
			Array.isArray(parsed)
				? parsed.filter((value): value is string => typeof value === "string")
				: []
		);
	} catch {
		return new Set();
	}
}

function writeShownDeletedSpaceNotices(shown: Set<string>): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			DELETED_SPACE_NOTICE_STORAGE_KEY,
			JSON.stringify(Array.from(shown))
		);
	} catch {
		// Best-effort; a failed write just means the notice may show again.
	}
}

export function AppSpacesSidebar(input: {
	browseSpacesActive?: boolean;
	currentProfileId: string;
	currentSpaceId: string;
}) {
	const navigate = useNavigate();
	const { currentOrganization } = useAppOrganization();
	const currentOrganizationId = currentOrganization.id;
	const orgSlug = currentOrganization.slug;
	const browseSpacesActive =
		input.browseSpacesActive ?? input.currentSpaceId.length === 0;
	const sidebarTimeFormatter = useSyncExternalStore(
		subscribeToBrowserEnvironment,
		getBrowserEnvironmentSnapshot,
		getServerEnvironmentSnapshot
	)
		? BROWSER_SIDEBAR_TIME_FORMATTER
		: UTC_SIDEBAR_TIME_FORMATTER;
	const spacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: input.currentProfileId.trim().length > 0,
			profileId: input.currentProfileId,
			scope: "account",
		})
	);
	const {
		activeWakeSummaryBySpaceId: ambientActiveWakeSummaryBySpaceId,
		unreadBySpaceId,
	} = useAccountSpaceIndicators({
		enabled: input.currentProfileId.trim().length > 0,
		organizationId: currentOrganizationId,
		profileId: input.currentProfileId,
	});
	const currentSpaceWakeProgressPresentationQuery = useQuery(
		spaceWakeProgressPresentationQueryOptions({
			openMeldProfileId: input.currentProfileId,
			spaceId: input.currentSpaceId,
		})
	);
	const currentSpaceActiveWakeProgressSummaryQuery = useQuery(
		spaceActiveWakeProgressSummaryQueryOptions({
			enabled: false,
			openMeldProfileId: input.currentProfileId,
			spaceId: input.currentSpaceId,
		})
	);
	const currentSpaceWakeProgressVisibleProjection =
		useSpaceWakeProgressVisibleProjection();
	const activeWakeSummaryBySpaceId = new Map<
		string,
		SpaceSidebarActiveWakeSummary
	>(
		Array.from(ambientActiveWakeSummaryBySpaceId).filter(
			([spaceId]) => spaceId !== input.currentSpaceId
		)
	);
	const currentSpaceWakeProgressItems =
		currentSpaceWakeProgressVisibleProjection ??
		mergeWakeProgressItems({
			currentItems:
				currentSpaceActiveWakeProgressSummaryQuery.data?.items ?? [],
			incomingItems: currentSpaceWakeProgressPresentationQuery.data ?? [],
		});
	if (
		input.currentSpaceId.trim().length > 0 &&
		hasVisibleActiveWakeProgress({
			items: currentSpaceWakeProgressItems,
		})
	) {
		activeWakeSummaryBySpaceId.set(
			input.currentSpaceId,
			buildCurrentSpaceActiveWakeSummary({
				fallbackSummary: ambientActiveWakeSummaryBySpaceId.get(
					input.currentSpaceId
				),
				items: currentSpaceWakeProgressItems,
				spaceId: input.currentSpaceId,
			})
		);
	}
	const pinMutation = useAccountSpacePinMutation({
		currentProfileId: input.currentProfileId,
	});
	const sections = spacesQuery.data ?? EMPTY_ACCOUNT_SPACE_SECTIONS;
	const selectedSections = selectAccountSpaceSections({
		currentOrganizationId,
		sections,
		unreadBySpaceId,
	});
	const sidebarSections = {
		...selectedSections,
		pinnedItems: prioritizeNewlyJoinedAccountSpaces(
			selectedSections.pinnedItems
		),
		spaceItems: prioritizeNewlyJoinedAccountSpaces(selectedSections.spaceItems),
	};
	// Space Index membership selects participation and history owners. Web route
	// identity stays the signed-in Human Profile; Core authorizes same-account
	// owner access without silently adding that Human to the Space.
	const resolveSpaceRoutePath = (item: AccountSpaceItem) =>
		buildOrganizationSpacePath({
			orgSlug,
			search: {
				profileId: input.currentProfileId,
			},
			spaceId: item.spaceId,
		});
	const openSpace = (routePath: string) => {
		navigate({
			to: routePath,
		}).catch((error) => {
			console.error("Failed to open space from sidebar.", error);
		});
	};
	const renderSpacesList = (listInput: {
		isError?: boolean;
		isPending?: boolean;
		items: readonly AccountSpaceItem[];
		navigationLabel: string;
	}) => (
		<SidebarSpacesList
			activeWakeSummaryBySpaceId={activeWakeSummaryBySpaceId}
			currentSpaceId={input.currentSpaceId}
			isError={listInput.isError ?? false}
			isPending={listInput.isPending ?? false}
			isPinPending={() => pinMutation.arePinActionsPending}
			items={listInput.items}
			lastJoinedAtFormatter={sidebarTimeFormatter}
			navigationLabel={listInput.navigationLabel}
			onOpenSpace={openSpace}
			onRetry={() => {
				spacesQuery.refetch().catch((error) => {
					console.error("Failed to refresh spaces.", error);
				});
			}}
			onTogglePinned={pinMutation.toggle}
			resolveRoutePath={resolveSpaceRoutePath}
			unreadBySpaceId={unreadBySpaceId}
		/>
	);
	const sidebarGroups: AppContextualNavGroup<"browse-spaces">[] = [
		{
			ariaLabel: "Space discovery",
			id: "discover",
			items: [
				{
					icon: CompassIcon,
					id: "browse-spaces",
					label: "Browse Spaces",
				},
			],
			label: "Explore",
		},
	];
	if (sidebarSections.pinnedItems.length > 0) {
		sidebarGroups.push({
			ariaLabel: "Pinned Spaces",
			content: renderSpacesList({
				items: sidebarSections.pinnedItems,
				navigationLabel: "Pinned Spaces",
			}),
			id: "pinned",
			label: "Pinned",
		});
	}
	sidebarGroups.push({
		ariaLabel: "Workspace Spaces",
		content: renderSpacesList({
			isError: spacesQuery.isError && spacesQuery.data === undefined,
			isPending: spacesQuery.isPending,
			items: sidebarSections.spaceItems,
			navigationLabel: "Spaces",
		}),
		id: "spaces",
		label: "Spaces",
	});

	// Surface whole-space deletions the viewer was a member of as a one-time toast.
	// The deleted Space DO (and its signal channel) is gone, so the durable Space
	// Index projection is the only place a former member can learn it. Shown ids are
	// tracked in localStorage so a deletion announces once; they age out with the
	// server's recent window.
	useEffect(() => {
		const items = sections.recentlyDeletedItems ?? [];
		if (items.length === 0) {
			return;
		}
		const shown = readShownDeletedSpaceNotices();
		for (const item of items) {
			if (!shown.has(item.spaceId)) {
				toast(
					`${item.deletedByProfileName ?? "Someone"} deleted "${item.spaceName ?? "a space"}".`
				);
			}
		}
		writeShownDeletedSpaceNotices(new Set(items.map((item) => item.spaceId)));
	}, [sections.recentlyDeletedItems]);

	return (
		<AppContextualSidebarNav
			activeItemId={browseSpacesActive ? "browse-spaces" : null}
			ariaLabel="Spaces"
			groups={sidebarGroups}
			leadingContent={
				<NewSpaceButton
					onClick={() => {
						navigate({
							to: buildOrganizationNewSpacePath(orgSlug),
						}).catch((error) => {
							console.error("Failed to open create-space flow.", error);
						});
					}}
				/>
			}
			onActivate={() => {
				navigate({
					to: buildOrganizationSpacesPath(orgSlug),
				}).catch((error) => {
					console.error("Failed to browse organization Spaces.", error);
				});
			}}
			title="Spaces"
		/>
	);
}

function NewSpaceButton(input: { onClick: () => void }) {
	return (
		<Button
			className="w-full justify-start"
			onClick={input.onClick}
			size="sm"
			type="button"
			variant="outline"
		>
			<PlusIcon data-icon="inline-start" />
			New Space
		</Button>
	);
}

function SidebarSpacesList(input: {
	activeWakeSummaryBySpaceId: ReadonlyMap<
		string,
		SpaceSidebarActiveWakeSummary
	>;
	currentSpaceId: string;
	isError: boolean;
	isPending: boolean;
	isPinPending: (item: AccountSpaceItem) => boolean;
	items: readonly AccountSpaceItem[];
	lastJoinedAtFormatter: Intl.DateTimeFormat;
	navigationLabel: string;
	onOpenSpace: (routePath: string) => void;
	onRetry: () => void;
	onTogglePinned: (item: AccountSpaceItem) => void;
	resolveRoutePath: (item: AccountSpaceItem) => string;
	unreadBySpaceId: SpaceUnreadById;
}) {
	if (input.isPending) {
		return (
			<div className="flex flex-col gap-1">
				{Array.from({ length: 6 }).map((_, index) => (
					<div
						className="flex h-10 items-center gap-2 px-2"
						key={`space-sidebar-skeleton-${String(index)}`}
					>
						<Skeleton className="size-4" />
						<Skeleton className="h-4 flex-1" />
					</div>
				))}
			</div>
		);
	}

	if (input.isError) {
		return (
			<div className="flex flex-col gap-3 p-2">
				<p className="text-muted-foreground text-xs">
					OpenMeld could not load your spaces.
				</p>
				<Button
					onClick={input.onRetry}
					size="sm"
					type="button"
					variant="outline"
				>
					Retry
				</Button>
			</div>
		);
	}

	if (input.items.length === 0) {
		return <p className="p-2 text-muted-foreground text-xs">No spaces yet.</p>;
	}

	return (
		<FluidNavMenu
			activeIndicatorClassName="bg-sidebar-accent"
			activeValue={input.currentSpaceId || null}
			aria-label={input.navigationLabel}
			focusIndicatorClassName="border-sidebar-ring"
			hoverIndicatorClassName="bg-sidebar-accent"
		>
			{input.items.map((item, index) => {
				const isActive = item.spaceId === input.currentSpaceId;
				const unread = input.unreadBySpaceId.get(item.spaceId);
				return (
					<SpaceSidebarMenuItem
						activeWakeSummary={input.activeWakeSummaryBySpaceId.get(
							item.spaceId
						)}
						index={index}
						isActive={isActive}
						isPinPending={input.isPinPending(item)}
						item={item}
						key={item.spaceId}
						lastJoinedAtFormatter={input.lastJoinedAtFormatter}
						onOpenSpace={input.onOpenSpace}
						onTogglePinned={input.onTogglePinned}
						routePath={input.resolveRoutePath(item)}
						unreadCount={unread?.unreadCount ?? 0}
					/>
				);
			})}
		</FluidNavMenu>
	);
}

function SpaceSidebarMenuItem(input: {
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
	const isNewSpace = isNewlyJoinedAccountSpace(input.item);
	const trailingStatus = resolveAccountSpaceTrailingStatus({
		hasActiveWake,
		hasUnread,
		isPinned,
	});
	const openLabel = buildSpaceSidebarOpenLabel({
		hasActiveWake,
		hasUnread,
		isWaitingForCodexTask:
			activeWakePresentation?.isWaitingForCodexTask ?? false,
		isNewSpace,
		spaceName: input.item.spaceName,
	});
	return (
		<FluidNavMenuItem
			className="group/space-row"
			index={input.index}
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
								aria-label={openLabel}
								className={resolveSpaceSidebarOpenButtonClassName({
									hasUnread,
									isNewSpace,
								})}
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
											trailingStatus !== null ? "pr-10" : null
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
							<button
								aria-label={pinLabel}
								aria-pressed={isPinned}
								className={cn(
									"pointer-events-none absolute top-1 right-1 inline-flex size-7 translate-x-1 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none backdrop-blur-sm transition-[transform,opacity,background-color,color] duration-150 ease-out hover:text-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-40 group-focus-within/space-row:pointer-events-auto group-focus-within/space-row:translate-x-0 group-focus-within/space-row:bg-sidebar-accent group-focus-within/space-row:opacity-100 group-hover/space-row:pointer-events-auto group-hover/space-row:translate-x-0 group-hover/space-row:bg-sidebar-accent group-hover/space-row:opacity-100 motion-reduce:transition-none",
									isPinned ? "text-foreground" : null,
									trailingStatus === "pinned"
										? "pointer-events-auto translate-x-0 opacity-100"
										: null
								)}
								disabled={input.isPinPending}
								onClick={(event) => {
									event.stopPropagation();
									input.onTogglePinned(input.item);
								}}
								type="button"
							>
								<PushPinIcon
									className="size-4"
									weight={isPinned ? "fill" : "regular"}
								/>
							</button>
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
	isWaitingForCodexTask: boolean;
	isNewSpace: boolean;
	spaceName: string;
}): string {
	const statuses = [
		input.isNewSpace ? "New Space" : null,
		input.hasUnread ? "unread messages" : null,
		resolveSpaceSidebarActiveWakeLabel(input),
	].filter(Boolean);
	return statuses.length > 0
		? `${input.spaceName}, ${statuses.join(", ")}`
		: input.spaceName;
}

function resolveSpaceSidebarActiveWakeLabel(input: {
	hasActiveWake: boolean;
	isWaitingForCodexTask: boolean;
}): string | null {
	if (!input.hasActiveWake) {
		return null;
	}
	return input.isWaitingForCodexTask ? "agent waiting" : "agent working";
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
	const { isWaitingForCodexTask, label } = input.presentation;
	return (
		<Tooltip>
			<TooltipTrigger
				delay={0}
				render={
					<button
						aria-label={`${label}. Open ${input.spaceName}`}
						className={cn(
							SPACE_SIDEBAR_PERSISTENT_STATUS_CLASS_NAME,
							"pointer-events-auto rounded-full outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-focus-within/space-row:scale-[0.625] group-hover/space-row:scale-[0.625]",
							isWaitingForCodexTask ? "text-muted-foreground" : null
						)}
						data-space-active-wake-orb={
							isWaitingForCodexTask ? undefined : "true"
						}
						data-space-active-wake-waiting={
							isWaitingForCodexTask ? "true" : undefined
						}
						onClick={input.onOpen}
						type="button"
					>
						{isWaitingForCodexTask ? (
							<HourglassMediumIcon className="size-4" />
						) : (
							<SpaceAgentOrb />
						)}
					</button>
				}
			/>
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	);
}

function resolveSpaceSidebarOpenButtonClassName(input: {
	hasUnread: boolean;
	isNewSpace: boolean;
}): string {
	return cn(
		"flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left outline-none",
		input.hasUnread ? "font-semibold text-sidebar-foreground" : null,
		input.isNewSpace ? "font-semibold text-primary" : null
	);
}

function buildCurrentSpaceActiveWakeSummary(input: {
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
	isWaitingForCodexTask: boolean;
	label: string;
};

function resolveSpaceActiveWakePresentation(
	summary: SpaceSidebarActiveWakeSummary
): SpaceActiveWakePresentation {
	const isWaitingForCodexTask =
		summary.waitReasonCode ===
		WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE;
	const activeTargets = summary.activeTargets ?? [];
	if (activeTargets.length > 0) {
		return {
			isWaitingForCodexTask,
			label: resolveAttributedSpaceWakeStatusLabel({
				activeTargets,
				isWaitingForCodexTask,
			}),
		};
	}
	return {
		isWaitingForCodexTask,
		label: resolveGenericSpaceWakeStatusLabel({
			activeWakeCount: summary.activeWakeCount,
			isWaitingForCodexTask,
		}),
	};
}

function resolveGenericSpaceWakeStatusLabel(input: {
	activeWakeCount: number;
	isWaitingForCodexTask: boolean;
}): string {
	if (input.isWaitingForCodexTask) {
		return input.activeWakeCount === 1
			? "An agent is waiting for its Codex task"
			: `${String(input.activeWakeCount)} Wakes are waiting for Codex tasks`;
	}
	return input.activeWakeCount === 1
		? "An agent is working"
		: `${String(input.activeWakeCount)} Wakes are active`;
}

function resolveAttributedSpaceWakeStatusLabel(input: {
	activeTargets: NonNullable<SpaceSidebarActiveWakeSummary["activeTargets"]>;
	isWaitingForCodexTask: boolean;
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
	const status = input.isWaitingForCodexTask
		? `${plural ? "are" : "is"} waiting for ${plural ? "their" : "its"} Codex task`
		: `${plural ? "are" : "is"} working`;
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
