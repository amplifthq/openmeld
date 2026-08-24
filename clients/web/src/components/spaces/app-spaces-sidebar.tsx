"use client";

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
	PlusIcon,
	PushPinIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
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
import {
	type RouteIntentPrefetchController,
	useRouteIntentPrefetch,
} from "#/components/app/use-route-intent-prefetch";
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
	type SpaceUnreadById,
	selectAccountSpaceSections,
} from "./account-space-sections";
import { SpaceAgentOrb } from "./space-agent-orb";
import { useSpaceWakeProgressVisibleProjection } from "./space-wake-progress-visible-projection";
import { useAccountSpaceIndicators } from "./use-account-space-indicators";
import { useAccountSpacePinMutation } from "./use-account-space-pin-mutation";
import {
	type SpaceConversationIntentPrefetch,
	useSpaceConversationIntentPrefetch,
} from "./use-space-conversation-intent-prefetch";

const SIDEBAR_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
});

const EMPTY_ACCOUNT_SPACE_SECTIONS: AccountSpaceSections = {
	pinnedItems: [],
	recentlyDeletedItems: [],
	spaceItems: [],
};

const DELETED_SPACE_NOTICE_STORAGE_KEY = "openmeld:deleted-space-notices-shown";
const SPACE_SIDEBAR_PERSISTENT_STATUS_CLASS_NAME =
	"pointer-events-none absolute top-1 right-1 z-10 inline-flex size-7 items-center justify-center transition-transform duration-150 ease-out group-focus-within/space-row:translate-x-3 group-focus-within/space-row:-translate-y-3 group-hover/space-row:translate-x-3 group-hover/space-row:-translate-y-3 motion-reduce:transition-none";

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
	const routeIntentPrefetch = useRouteIntentPrefetch();
	const prefetchSpaceConversation = useSpaceConversationIntentPrefetch();
	const spacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: input.currentProfileId.trim().length > 0,
			profileId: input.currentProfileId,
			scope: "account",
		})
	);
	const { activeWakeSpaceIds: ambientActiveWakeSpaceIds, unreadBySpaceId } =
		useAccountSpaceIndicators({
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
	const activeWakeSpaceIds = new Set(
		Array.from(ambientActiveWakeSpaceIds).filter(
			(spaceId) => spaceId !== input.currentSpaceId
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
		activeWakeSpaceIds.add(input.currentSpaceId);
	}
	const pinMutation = useAccountSpacePinMutation({
		currentProfileId: input.currentProfileId,
	});
	const sections = spacesQuery.data ?? EMPTY_ACCOUNT_SPACE_SECTIONS;
	const sidebarSections = selectAccountSpaceSections({
		currentOrganizationId,
		sections,
		unreadBySpaceId,
	});
	const resolveSpaceRoutePath = (item: AccountSpaceItem) =>
		buildOrganizationSpacePath({
			orgSlug,
			search: { profileId: input.currentProfileId },
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
			activeWakeSpaceIds={activeWakeSpaceIds}
			currentSpaceId={input.currentSpaceId}
			isError={listInput.isError ?? false}
			isPending={listInput.isPending ?? false}
			isPinPending={() => pinMutation.arePinActionsPending}
			items={listInput.items}
			navigationLabel={listInput.navigationLabel}
			onOpenSpace={openSpace}
			onRetry={() => {
				spacesQuery.refetch().catch((error) => {
					console.error("Failed to refresh spaces.", error);
				});
			}}
			onTogglePinned={pinMutation.toggle}
			openMeldProfileId={input.currentProfileId}
			prefetchSpaceConversation={prefetchSpaceConversation}
			resolveRoutePath={resolveSpaceRoutePath}
			routeIntentPrefetch={routeIntentPrefetch}
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
			isError: spacesQuery.isError,
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
	activeWakeSpaceIds: ReadonlySet<string>;
	currentSpaceId: string;
	isError: boolean;
	isPending: boolean;
	isPinPending: (item: AccountSpaceItem) => boolean;
	items: readonly AccountSpaceItem[];
	navigationLabel: string;
	onOpenSpace: (routePath: string) => void;
	onRetry: () => void;
	onTogglePinned: (item: AccountSpaceItem) => void;
	prefetchSpaceConversation: SpaceConversationIntentPrefetch;
	resolveRoutePath: (item: AccountSpaceItem) => string;
	routeIntentPrefetch: RouteIntentPrefetchController;
	unreadBySpaceId: SpaceUnreadById;
	openMeldProfileId: string;
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
						hasActiveWake={input.activeWakeSpaceIds.has(item.spaceId)}
						index={index}
						isActive={isActive}
						isPinPending={input.isPinPending(item)}
						item={item}
						key={item.spaceId}
						onOpenSpace={input.onOpenSpace}
						onTogglePinned={input.onTogglePinned}
						openMeldProfileId={input.openMeldProfileId}
						prefetchSpaceConversation={input.prefetchSpaceConversation}
						routeIntentPrefetch={input.routeIntentPrefetch}
						routePath={input.resolveRoutePath(item)}
						unreadCount={unread?.unreadCount ?? 0}
					/>
				);
			})}
		</FluidNavMenu>
	);
}

function SpaceSidebarMenuItem(input: {
	hasActiveWake: boolean;
	index: number;
	isActive: boolean;
	isPinPending: boolean;
	item: AccountSpaceItem;
	onOpenSpace: (routePath: string) => void;
	onTogglePinned: (item: AccountSpaceItem) => void;
	prefetchSpaceConversation: SpaceConversationIntentPrefetch;
	routeIntentPrefetch: RouteIntentPrefetchController;
	routePath: string;
	unreadCount: number;
	openMeldProfileId: string;
}) {
	const isPinned = input.item.pinnedAt !== null;
	const hasActiveWake = input.hasActiveWake;
	const pinLabel = isPinned
		? `Unpin ${input.item.spaceName}`
		: `Pin ${input.item.spaceName}`;
	const hasUnread = input.unreadCount > 0;
	const trailingStatus = resolveSpaceSidebarTrailingStatus({
		hasActiveWake,
		hasUnread,
		isPinned,
	});
	const openLabelStatuses = [
		hasUnread ? "unread messages" : null,
		hasActiveWake ? "agent working" : null,
	].filter(Boolean);
	const openLabel =
		openLabelStatuses.length > 0
			? `${input.item.spaceName}, ${openLabelStatuses.join(", ")}`
			: input.item.spaceName;
	const prefetchConversationData = () =>
		input.prefetchSpaceConversation({
			spaceId: input.item.spaceId,
			openMeldProfileId: input.openMeldProfileId,
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
							<button
								aria-label={openLabel}
								className={cn(
									"flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left outline-none",
									hasUnread ? "font-semibold text-sidebar-foreground" : null
								)}
								onClick={() => input.onOpenSpace(input.routePath)}
								onFocus={
									input.isActive
										? undefined
										: () =>
												input.routeIntentPrefetch.prefetchNow(
													input.routePath,
													prefetchConversationData
												)
								}
								onPointerDown={
									input.isActive
										? undefined
										: () =>
												input.routeIntentPrefetch.prefetchNow(
													input.routePath,
													prefetchConversationData
												)
								}
								onPointerEnter={
									input.isActive
										? undefined
										: () =>
												input.routeIntentPrefetch.schedule(
													input.routePath,
													prefetchConversationData
												)
								}
								onPointerLeave={
									input.isActive
										? undefined
										: () => input.routeIntentPrefetch.cancel(input.routePath)
								}
								type="button"
							>
								<HashIcon data-icon="inline-start" data-space-icon="channel" />
								<CenterTruncatedText
									className={cn(
										"min-w-0 flex-1 @[13rem]/space-item:pr-10",
										trailingStatus !== null ? "pr-10" : null
									)}
									text={input.item.spaceName}
								/>
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
								<span
									className={cn(
										"absolute top-2 right-2 @[13rem]/space-item:block hidden text-muted-foreground text-xs transition-opacity",
										trailingStatus !== null
											? "opacity-0"
											: "opacity-100 group-focus-within/space-row:opacity-0 group-hover/space-row:opacity-0"
									)}
								>
									{formatLastJoinedAt(input.item.lastJoinedAt)}
								</span>
							</button>
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

				{trailingStatus === "working" ? (
					<span
						aria-hidden="true"
						className={cn(
							SPACE_SIDEBAR_PERSISTENT_STATUS_CLASS_NAME,
							"group-focus-within/space-row:scale-[0.625] group-hover/space-row:scale-[0.625]"
						)}
						data-space-active-wake-orb="true"
					>
						<SpaceAgentOrb />
					</span>
				) : null}
			</div>
		</FluidNavMenuItem>
	);
}

function resolveSpaceSidebarTrailingStatus(input: {
	hasActiveWake: boolean;
	hasUnread: boolean;
	isPinned: boolean;
}): "pinned" | "unread" | "working" | null {
	if (input.hasUnread) {
		return "unread";
	}
	if (input.hasActiveWake) {
		return "working";
	}
	if (input.isPinned) {
		return "pinned";
	}
	return null;
}

function formatLastJoinedAt(value: string): string {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		return "";
	}

	return SIDEBAR_TIME_FORMATTER.format(timestamp);
}
