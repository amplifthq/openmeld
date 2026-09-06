"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { FunnelSimpleIcon } from "@phosphor-icons/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
	type AppContextualNavGroup,
	AppContextualSidebarNav,
} from "#/components/app/app-contextual-layout";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationNewSpacePath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import type {
	AccountSpaceItem,
	AccountSpaceSections,
} from "#/lib/spaces/account-spaces";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import { SidebarDestinationAction } from "../app/sidebar-destination-actions";
import {
	SidebarDrag as SidebarSpaceDrag,
	SidebarDropSection as SidebarSpaceDropSection,
} from "../app/sidebar-drag";
import { useSidebarGroupFilter } from "../app/sidebar-group-filter";
import { SidebarSearchInput } from "../app/sidebar-search-input";
import { SidebarSectionActions } from "../app/sidebar-section-actions";
import { useSidebarPreferences } from "../app/use-sidebar-preferences";
import {
	type SpaceUnreadById,
	selectAccountSpaceSections,
} from "./account-space-sections";
import { spaceMessagePreviewQueryOptions } from "./direct-message-preview";
import { moveSidebarSpace, sortSidebarSpaces } from "./sidebar-space-order";
import { SortableSpaceSidebarItem } from "./sortable-space-sidebar-item";
import type { SpaceSidebarActiveWakeSummary } from "./space-active-wake-presentation";
import {
	resolveSpaceMemberAppearances,
	type SpaceMemberAppearance,
} from "./space-member-avatars";
import { useAccountSpacePinMutation } from "./use-account-space-pin-mutation";
import { useSpaceListIndicators } from "./use-space-list-indicators";

const EMPTY_ACCOUNT_SPACE_SECTIONS: AccountSpaceSections = {
	pinnedItems: [],
	recentlyDeletedItems: [],
	spaceItems: [],
};

const DELETED_SPACE_NOTICE_STORAGE_KEY = "openmeld:deleted-space-notices-shown";
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
	const [search, setSearch] = useState("");
	const { currentOrganization } = useAppOrganization();
	const currentOrganizationId = currentOrganization.id;
	const profileDirectory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: input.currentProfileId.trim().length > 0,
			organizationId: currentOrganizationId,
		})
	);
	const memberAppearances = useMemo(
		() => resolveSpaceMemberAppearances(profileDirectory.data),
		[profileDirectory.data]
	);
	const orgSlug = currentOrganization.slug;
	const sidebar = useSidebarPreferences(
		input.currentProfileId,
		currentOrganizationId
	);
	const browserEnvironmentReady = useSyncExternalStore(
		subscribeToBrowserEnvironment,
		getBrowserEnvironmentSnapshot,
		getServerEnvironmentSnapshot
	);
	const spacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: input.currentProfileId.trim().length > 0,
			profileId: input.currentProfileId,
			scope: "account",
		})
	);
	const sections = spacesQuery.data ?? EMPTY_ACCOUNT_SPACE_SECTIONS;
	const { activeWakeSummaryBySpaceId, unreadBySpaceId } =
		useSpaceListIndicators({
			currentProfileId: input.currentProfileId,
			currentSpaceId: input.currentSpaceId,
			organizationId: currentOrganizationId,
			sections,
			browserEnvironmentReady,
		});
	const pinMutation = useAccountSpacePinMutation({
		currentProfileId: input.currentProfileId,
	});
	const selectedSections = selectAccountSpaceSections({
		currentOrganizationId,
		sections,
		unreadBySpaceId,
	});
	const sidebarSections = selectedSections;
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
		section: string;
		isError?: boolean;
		isPending?: boolean;
		items: readonly AccountSpaceItem[];
		navigationLabel: string;
	}) => (
		<SidebarSpaceDropSection
			ids={listInput.items.map((item) => item.spaceId)}
			section={listInput.section}
		>
			<SidebarSpacesList
				activeWakeSummaryBySpaceId={activeWakeSummaryBySpaceId}
				currentSpaceId={input.currentSpaceId}
				dragDisabled={sidebar.disabled || pinMutation.arePinActionsPending}
				isError={listInput.isError ?? false}
				isPending={listInput.isPending ?? false}
				isPinPending={() => pinMutation.arePinActionsPending}
				items={listInput.items}
				memberAppearances={memberAppearances}
				navigationLabel={listInput.navigationLabel}
				onOpenSpace={openSpace}
				onRetry={() => {
					spacesQuery.refetch().catch((error) => {
						console.error("Failed to refresh spaces.", error);
					});
				}}
				onTogglePinned={pinMutation.toggle}
				resolveRoutePath={resolveSpaceRoutePath}
				section={listInput.section}
				unreadBySpaceId={unreadBySpaceId}
			/>
		</SidebarSpaceDropSection>
	);
	const preferences = sidebar.preferences;
	const conversationItems = [
		...sidebarSections.pinnedItems,
		...sidebarSections.spaceItems,
	];
	const latestMessages = useQueries({
		queries: conversationItems.map((item) =>
			spaceMessagePreviewQueryOptions({
				spaceId: item.spaceId,
				viewerProfileId: item.openProfileId,
				enabled: true,
			})
		),
	});
	const conversationActivity = new Map(
		conversationItems.map((item, index) => [
			item.spaceId,
			latestMessages[index]?.data?.timestamp ??
				(Date.parse(item.spaceCreatedAt ?? "") || 0),
		])
	);
	const groupFilter = useSidebarGroupFilter([
		{ id: "pinned", label: "Pinned" },
		...(preferences?.groups ?? []).map((group) => ({
			id: group.id,
			label: group.name,
		})),
		{ id: "spaces", label: "Spaces" },
	]);
	const visibleBySection = new Map<string, readonly AccountSpaceItem[]>();
	const actions = (id: string, label: string) => (
		<SidebarSectionActions
			disabled={sidebar.disabled || pinMutation.arePinActionsPending}
			label={label}
			onDelete={
				id !== "pinned" && id !== "spaces"
					? () => {
							if (preferences) {
								sidebar.save({
									...preferences,
									groups: preferences.groups.filter((group) => group.id !== id),
								});
							}
						}
					: undefined
			}
			onNewGroup={
				id === "spaces"
					? (name) => {
							if (preferences) {
								sidebar.save({
									...preferences,
									groups: [
										...preferences.groups,
										{
											id: crypto.randomUUID(),
											name,
											sort: "priority",
											spaceIds: [],
										},
									],
								});
							}
						}
					: undefined
			}
			onNewItem={
				id === "spaces"
					? () => openSpace(buildOrganizationNewSpacePath(orgSlug))
					: undefined
			}
			onSort={(sort) => {
				if (!preferences) {
					return;
				}
				if (id === "pinned" || id === "spaces") {
					sidebar.save({ ...preferences, [id]: { ...preferences[id], sort } });
				} else {
					sidebar.save({
						...preferences,
						groups: preferences.groups.map((group) =>
							group.id === id ? { ...group, sort } : group
						),
					});
				}
			}}
			sort={
				(id === "pinned" || id === "spaces"
					? preferences?.[id]
					: preferences?.groups.find((group) => group.id === id)
				)?.sort ?? "priority"
			}
		/>
	);
	const sidebarGroups: AppContextualNavGroup[] = [];
	const attention = new Set(
		[...activeWakeSummaryBySpaceId]
			.filter(([, summary]) =>
				summary.statuses?.some(
					(status) =>
						status.kind === "needs_input" || status.kind === "waiting_for_owner"
				)
			)
			.map(([id]) => id)
	);
	const unreadActivity = new Map(
		[...unreadBySpaceId]
			.filter(([, summary]) => summary.unreadCount > 0)
			.map(([id, summary]) => [id, summary.latestUnreadOccurredAtMs])
	);
	const working = new Set(
		[...activeWakeSummaryBySpaceId]
			.filter(([, summary]) => summary.activeWakeCount > 0)
			.map(([id]) => id)
	);
	const sortSection = (
		items: readonly AccountSpaceItem[],
		section: Parameters<typeof sortSidebarSpaces>[1]
	) =>
		sortSidebarSpaces(
			items.filter(
				(item) =>
					!search.trim() ||
					(item.spaceName ?? "")
						.toLocaleLowerCase()
						.includes(search.trim().toLocaleLowerCase())
			),
			section ?? { sort: "priority", spaceIds: [] },
			attention,
			unreadActivity,
			working,
			conversationActivity
		);
	if (sidebarSections.pinnedItems.length > 0) {
		const items = sortSection(sidebarSections.pinnedItems, preferences?.pinned);
		visibleBySection.set("pinned", items);
		sidebarGroups.push({
			ariaLabel: "Pinned Spaces",
			content: renderSpacesList({
				items,
				section: "pinned",
				navigationLabel: "Pinned Spaces",
			}),
			id: "pinned",
			label: "Pinned",
			labelAccessory: actions("pinned", "Pinned"),
		});
	}
	const groupedIds = new Set(
		preferences?.groups.flatMap((group) => group.spaceIds)
	);
	for (const group of preferences?.groups ?? []) {
		const ids = new Set(group.spaceIds);
		const items = sortSection(
			sidebarSections.spaceItems.filter((item) => ids.has(item.spaceId)),
			group
		);
		visibleBySection.set(group.id, items);
		sidebarGroups.push({
			id: group.id,
			label: group.name,
			onRename: (name) => {
				if (preferences) {
					sidebar.save({
						...preferences,
						groups: preferences.groups.map((item) =>
							item.id === group.id ? { ...item, name } : item
						),
					});
				}
			},
			ariaLabel: group.name,
			labelAccessory: actions(group.id, group.name),
			content: renderSpacesList({
				section: group.id,
				items,
				navigationLabel: group.name,
			}),
		});
	}
	const ordinaryItems = sortSection(
		sidebarSections.spaceItems.filter((item) => !groupedIds.has(item.spaceId)),
		preferences?.spaces
	);
	visibleBySection.set("spaces", ordinaryItems);
	sidebarGroups.push({
		ariaLabel: "Workspace Spaces",
		content: renderSpacesList({
			section: "spaces",
			isError: spacesQuery.isError && spacesQuery.data === undefined,
			isPending: spacesQuery.isPending,
			items: ordinaryItems,
			navigationLabel: "Spaces",
		}),
		id: "spaces",
		label: "Spaces",
		labelAccessory: actions("spaces", "Spaces"),
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

	if (sidebar.isPending || latestMessages.some((query) => query.isPending)) {
		return <Skeleton className="mx-2 h-32" />;
	}
	if (
		(!preferences && sidebar.isError) ||
		latestMessages.some((query) => query.isError && query.data === undefined)
	) {
		return (
			<Button
				onClick={() =>
					Promise.all([
						sidebar.retry(),
						...latestMessages
							.filter((query) => query.isError)
							.map((query) => query.refetch()),
					])
				}
				variant="ghost"
			>
				Retry loading sidebar
			</Button>
		);
	}
	return (
		<SidebarSpaceDrag
			onMove={async (section, spaceId, beforeId) => {
				if (preferences && !sidebar.disabled) {
					const item = [
						...sidebarSections.pinnedItems,
						...sidebarSections.spaceItems,
					].find((item) => item.spaceId === spaceId);
					if (
						!(item && (await pinMutation.setPinned(item, section === "pinned")))
					) {
						return;
					}
					sidebar.save(
						moveSidebarSpace(
							preferences,
							section,
							spaceId,
							(visibleBySection.get(section) ?? []).map((item) => item.spaceId),
							beforeId
						)
					);
				}
			}}
		>
			<AppContextualSidebarNav
				activeItemId={null}
				ariaLabel="Spaces"
				groups={sidebarGroups.filter(
					(group) =>
						groupFilter.includes(group.id) &&
						(!(search.trim() || groupFilter.selected.length > 0) ||
							spacesQuery.isPending ||
							spacesQuery.isError ||
							(visibleBySection.get(group.id)?.length ?? 0) > 0)
				)}
				leadingContent={
					<>
						<div className="flex items-center gap-1 px-1">
							<SidebarSearchInput
								destination="spaces"
								label="Search Spaces"
								onValueChange={setSearch}
								value={search}
							/>
							<SidebarDestinationAction destination="spaces">
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												aria-label="Filter Spaces"
												className="size-6 [&_svg]:size-3.5"
												size="icon-sm"
												variant="ghost"
											/>
										}
									>
										<FunnelSimpleIcon />
									</DropdownMenuTrigger>
									<FluidDropdownMenuContent
										align="end"
										className="w-60 max-w-[calc(100vw-2rem)]"
									>
										{groupFilter.menu}
									</FluidDropdownMenuContent>
								</DropdownMenu>
							</SidebarDestinationAction>
						</div>
						{groupFilter.badges}
						{(search.trim() || groupFilter.selected.length > 0) &&
							!spacesQuery.isPending &&
							!spacesQuery.isError &&
							![...visibleBySection].some(
								([id, items]) => groupFilter.includes(id) && items.length > 0
							) && (
								<p className="px-2 py-2 text-muted-foreground text-xs">
									No Spaces match your search or filters.
								</p>
							)}
						{sidebar.isError ? (
							<Button onClick={() => sidebar.retry()} size="sm" variant="ghost">
								Retry sidebar settings
							</Button>
						) : null}
					</>
				}
				placement="main"
				title="Spaces"
			/>
		</SidebarSpaceDrag>
	);
}

function SidebarSpacesList(input: {
	memberAppearances: ReadonlyMap<string, SpaceMemberAppearance>;
	section: string;
	dragDisabled: boolean;
	activeWakeSummaryBySpaceId: ReadonlyMap<
		string,
		SpaceSidebarActiveWakeSummary
	>;
	currentSpaceId: string;
	isError: boolean;
	isPending: boolean;
	isPinPending: (item: AccountSpaceItem) => boolean;
	items: readonly AccountSpaceItem[];
	navigationLabel: string;
	onOpenSpace: (routePath: string) => void;
	onRetry: () => void;
	onTogglePinned: (item: AccountSpaceItem) => void;
	resolveRoutePath: (item: AccountSpaceItem) => string;
	unreadBySpaceId: SpaceUnreadById;
}) {
	const { presentation } = useAppNavigationPresentation();
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
			activeLayoutId={`secondary-sidebar-selection-${presentation}`}
			activeValue={input.currentSpaceId || null}
			aria-label={input.navigationLabel}
		>
			{input.items.map((item, index) => {
				const isActive = item.spaceId === input.currentSpaceId;
				const unread = input.unreadBySpaceId.get(item.spaceId);
				return (
					<SortableSpaceSidebarItem
						activeWakeSummary={input.activeWakeSummaryBySpaceId.get(
							item.spaceId
						)}
						dragDisabled={input.dragDisabled}
						index={index}
						isActive={isActive}
						isPinPending={input.isPinPending(item)}
						item={item}
						key={item.spaceId}
						memberAppearances={input.memberAppearances}
						onOpenSpace={input.onOpenSpace}
						onTogglePinned={input.onTogglePinned}
						routePath={input.resolveRoutePath(item)}
						section={input.section}
						unreadCount={unread?.unreadCount ?? 0}
					/>
				);
			})}
		</FluidNavMenu>
	);
}
