import type { AccountSidebarPreferences } from "@openmeld/schemas";
import type {
	AuthProfileView,
	OrganizationSpaceDirectoryWithMemberCountsItem,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ChatCircleTextIcon,
	FunnelSimpleIcon,
	LockKeyIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useDeferredValue, useLayoutEffect, useRef, useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { buildProfilePath } from "#/lib/profile-routes";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { AppSidebarGroup } from "../app/app-sidebar-group";
import { DirectoryRowActions } from "../app/directory-row-actions";
import { DirectorySearch } from "../app/directory-search";
import { SidebarSectionActions } from "../app/sidebar-section-actions";
import { useSidebarPreferences } from "../app/use-sidebar-preferences";
import {
	resolveConversationTimestamp,
	SidebarConversationTime,
} from "./sidebar-conversation-time";
import { sortSidebarSpaces } from "./sidebar-space-order";
import {
	resolveSpaceActiveWakePresentation,
	type SpaceSidebarActiveWakeSummary,
} from "./space-active-wake-presentation";
import { SpaceAgentOrb } from "./space-agent-orb";
import { SpaceDirectoryPreview } from "./space-directory-preview";
import {
	resolveSpaceMemberAppearances,
	type SpaceMemberAppearance,
	SpaceMemberAvatars,
} from "./space-member-avatars";
import { useSpaceDirectoryFilters } from "./use-space-directory-filters";
import { useSpaceListIndicators } from "./use-space-list-indicators";
import { WelcomeSpaceLabel } from "./welcome-space-guide";

type DirectorySpace = OrganizationSpaceDirectoryWithMemberCountsItem;
export function SpaceDirectory(input: {
	accountProfiles: readonly AuthProfileView[];
	tab: number;
	accountSpaceItemsById: ReadonlyMap<string, AccountSpaceItem>;
	canJoinSpaces: boolean;
	joinError: { message: string; spaceId: string } | null;
	onJoinSpace: (spaceId: string) => void;
	onTogglePinned: (item: AccountSpaceItem) => void;
	orgSlug: string;
	pendingJoinSpaceId: string | null;
	pinActionsPending: boolean;
	profileId: string;
	spaces: readonly DirectorySpace[];
	savedViewWarning: { isRetrying: boolean; onRetry: () => void } | null;
}) {
	const { currentOrganization } = useAppOrganization();
	const sidebar = useSidebarPreferences(
		input.profileId,
		currentOrganization.id
	);
	const preferences = sidebar.preferences;
	const [searches, setSearches] = useState(["", ""]);
	const [searchOpen, setSearchOpen] = useState([false, false]);
	const [preview, setPreview] = useState<DirectorySpace | null>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const scrollPositions = useRef([0, 0]);
	useLayoutEffect(() => {
		if (viewportRef.current) {
			viewportRef.current.scrollTop = scrollPositions.current[input.tab] ?? 0;
		}
	}, [input.tab]);
	const search = searches[input.tab] ?? "";
	const searchTerm = useDeferredValue(search.trim().toLowerCase());
	const joinedIds = new Set(
		input.spaces.filter((space) => space.joined).map((space) => space.spaceId)
	);
	const items = [...input.accountSpaceItemsById.values()].filter((item) =>
		joinedIds.has(item.spaceId)
	);
	const sections = {
		pinnedItems: items.filter((item) => item.pinnedAt !== null),
		spaceItems: items.filter((item) => item.pinnedAt === null),
	};
	const indicators = useSpaceListIndicators({
		currentProfileId: input.profileId,
		currentSpaceId: "",
		organizationId: currentOrganization.id,
		sections,
	});
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			organizationId: currentOrganization.id,
			enabled: true,
		})
	);
	const appearances = resolveSpaceMemberAppearances(directory.data);
	const previews = new Map(
		items.map((item) => [item.spaceId, item.messagePreview])
	);
	const activity = new Map(
		items.map((item) => [
			item.spaceId,
			resolveConversationTimestamp(
				previews.get(item.spaceId)?.timestamp,
				item.spaceCreatedAt
			) ?? 0,
		])
	);
	const attention = new Set(
		[...indicators.activeWakeSummaryBySpaceId]
			.filter(([, value]) =>
				value.statuses?.some(
					(status) =>
						status.kind === "needs_input" || status.kind === "waiting_for_owner"
				)
			)
			.map(([id]) => id)
	);
	const unreadActivity = new Map(
		[...indicators.unreadBySpaceId]
			.filter(([, value]) => value.unreadCount > 0)
			.map(([id, value]) => [id, value.latestUnreadOccurredAtMs])
	);
	const working = new Set(
		[...indicators.activeWakeSummaryBySpaceId]
			.filter(([, value]) => value.activeWakeCount > 0)
			.map(([id]) => id)
	);
	const groups = [
		{ id: "pinned", label: "Pinned" },
		...(preferences?.groups ?? []).map((group) => ({
			id: group.id,
			label: group.name,
		})),
		{ id: "spaces", label: "Spaces" },
	];
	const grouped =
		(preferences?.groups.length ?? 0) > 0 || sections.pinnedItems.length > 0;
	const groupFilter = useSpaceDirectoryFilters(groups, () =>
		setSearchOpen((current) =>
			current.map((value, index) => (index === input.tab ? true : value))
		)
	);
	const statusFilters = groupFilter.statuses;
	const unindexed = input.spaces.filter(
		(space) =>
			space.joined &&
			!input.accountSpaceItemsById.has(space.spaceId) &&
			space.name.toLowerCase().includes(searchTerm) &&
			statusFilters.length === 0
	);
	const groupedIds = new Set(
		preferences?.groups.flatMap((group) => group.spaceIds)
	);
	const matches = (item: AccountSpaceItem) =>
		item.spaceName.toLowerCase().includes(searchTerm) &&
		groupFilter.matchesStatus(
			indicators.unreadBySpaceId.get(item.spaceId)?.unreadCount ?? 0,
			indicators.activeWakeSummaryBySpaceId.get(item.spaceId)
		);
	const entries = groups
		.map((group) => {
			const section =
				group.id === "pinned" || group.id === "spaces"
					? preferences?.[group.id]
					: preferences?.groups.find((entry) => entry.id === group.id);
			let members = sections.pinnedItems;
			if (group.id === "spaces") {
				members = sections.spaceItems.filter(
					(item) => !groupedIds.has(item.spaceId)
				);
			} else if (group.id !== "pinned") {
				members = sections.spaceItems.filter((item) =>
					section?.spaceIds.includes(item.spaceId)
				);
			}
			return {
				...group,
				section,
				unindexed: group.id === "spaces" ? unindexed : [],
				items: sortSidebarSpaces(
					members.filter(matches),
					section ?? { sort: "priority", spaceIds: [] },
					attention,
					unreadActivity,
					working,
					activity
				),
			};
		})
		.filter((group) => groupFilter.includes(group.id));
	const discovering = input.tab === 1;
	const discoverable = input.spaces.filter(
		(space) =>
			!space.joined &&
			space.visibility === "public" &&
			space.name.toLowerCase().includes(searchTerm)
	);
	const { loading, blockingError } = resolveDirectoryLoadingState(
		discovering,
		sidebar
	);
	const changeSection = (
		id: string,
		update: {
			sort?: AccountSidebarPreferences["spaces"]["sort"];
			name?: string;
		}
	) => {
		if (!preferences) {
			return;
		}
		if (id === "pinned" || id === "spaces") {
			sidebar.save({ ...preferences, [id]: { ...preferences[id], ...update } });
		} else {
			sidebar.save({
				...preferences,
				groups: preferences.groups.map((group) =>
					group.id === id ? { ...group, ...update } : group
				),
			});
		}
	};
	return (
		<div
			aria-label={discovering ? "Discover" : "Your Spaces"}
			aria-labelledby={`spaces-directory-tab-${input.tab}`}
			className="flex h-full min-h-0 flex-col"
			id={`spaces-directory-panel-${input.tab}`}
			role="tabpanel"
		>
			<div className="flex h-16 shrink-0 items-center justify-end gap-3 px-[var(--app-page-inline-padding)]">
				<div className="flex h-11 min-w-0 items-center justify-end gap-1">
					<DirectorySearch
						label="Search Spaces"
						onChange={(next) =>
							setSearches((current) =>
								current.map((value, index) =>
									index === input.tab ? next : value
								)
							)
						}
						onOpenChange={(next) =>
							setSearchOpen((current) =>
								current.map((value, index) =>
									index === input.tab ? next : value
								)
							)
						}
						open={searchOpen[input.tab] ?? false}
						value={search}
					/>
					{!discovering && (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										aria-label="Filter Spaces"
										size="icon-sm"
										variant="ghost"
									/>
								}
							>
								<FunnelSimpleIcon />
							</DropdownMenuTrigger>
							<FluidDropdownMenuContent align="end" className="w-56">
								{groupFilter.menu}
							</FluidDropdownMenuContent>
						</DropdownMenu>
					)}
					{!(discovering || grouped) && (
						<DirectoryGroupActions
							alwaysVisible
							group={{
								id: "spaces",
								label: "Spaces",
								section: preferences?.spaces,
							}}
							onSort={(sort) => changeSection("spaces", { sort })}
							sidebar={sidebar}
						/>
					)}
				</div>
			</div>
			{!discovering &&
				(groupFilter.selected.length > 0 || statusFilters.length > 0) && (
					<div className="flex flex-wrap items-center gap-1 px-[var(--app-page-inline-padding)] pb-3">
						{groupFilter.badges}
					</div>
				)}
			{input.savedViewWarning && (
				<output className="flex items-center justify-between px-[var(--app-page-inline-padding)] pb-3 text-muted-foreground text-sm">
					Couldn't refresh Spaces. Showing the last saved view.
					<Button
						disabled={input.savedViewWarning.isRetrying}
						onClick={input.savedViewWarning.onRetry}
						size="sm"
						variant="ghost"
					>
						Retry
					</Button>
				</output>
			)}
			<ScrollArea
				className="min-h-0 flex-1"
				contentClassName="px-[calc(var(--app-page-inline-padding)_-_0.5rem)] pb-8"
				viewportProps={{
					onScroll: (event) => {
						scrollPositions.current[input.tab] = event.currentTarget.scrollTop;
					},
				}}
				viewportRef={viewportRef}
			>
				{blockingError && (
					<div className="p-6 text-sm" role="alert">
						Couldn't load the saved Space order.
						<Button
							onClick={() => {
								sidebar.retry();
							}}
							variant="ghost"
						>
							Retry
						</Button>
					</div>
				)}
				{!blockingError && loading && (
					<section
						aria-busy="true"
						aria-label="Loading Spaces"
						className="space-y-4 p-3"
					>
						{[0, 1, 2, 3].map((id) => (
							<Skeleton className="h-16 w-full" key={id} />
						))}
					</section>
				)}
				{discovering && (
					<DiscoverList
						input={input}
						onPreview={setPreview}
						searching={Boolean(searchTerm)}
						spaces={discoverable}
					/>
				)}
				{!(discovering || blockingError || loading) && (
					<div className="space-y-6">
						{entries
							.filter(
								(group) =>
									group.id === "spaces" ||
									groupFilter.selected.includes(group.id) ||
									group.items.length > 0 ||
									(!searchTerm &&
										statusFilters.length === 0 &&
										group.id !== "pinned")
							)
							.map((group) => (
								<AppSidebarGroup
									contentOnly={!grouped}
									groupClassName="p-0"
									groupId={`directory-${group.id}`}
									key={group.id}
									label={<span>{group.label}</span>}
									labelAccessory={
										<DirectoryGroupActions
											group={group}
											onSort={(sort) => changeSection(group.id, { sort })}
											sidebar={sidebar}
										/>
									}
									labelClassName="px-2"
									labelText={group.label}
									onRename={
										group.id !== "pinned" && group.id !== "spaces"
											? (name) => changeSection(group.id, { name })
											: undefined
									}
								>
									<Table className="w-full table-fixed">
										<TableHeader>
											<TableRow>
												<TableHead className="w-auto">Space</TableHead>
												<TableHead className="hidden w-48 lg:table-cell">
													Status
												</TableHead>
												<TableHead className="hidden w-28 md:table-cell">
													Members
												</TableHead>
												<TableHead className="w-28">Activity</TableHead>
												<TableHead className="w-20">
													<span className="sr-only">Actions</span>
												</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{group.items.map((item, index) => (
												<JoinedRow
													appearances={appearances}
													disabled={sidebar.disabled}
													index={index}
													input={input}
													item={item}
													key={item.spaceId}
													preferences={preferences}
													preview={previews.get(item.spaceId)}
													save={sidebar.save}
													summary={indicators.activeWakeSummaryBySpaceId.get(
														item.spaceId
													)}
													unread={
														indicators.unreadBySpaceId.get(item.spaceId)
															?.unreadCount ?? 0
													}
												/>
											))}
											{group.unindexed.map((space, index) => (
												<UnindexedJoinedRow
													index={group.items.length + index}
													key={space.spaceId}
													orgSlug={input.orgSlug}
													profileId={input.profileId}
													space={space}
												/>
											))}
										</TableBody>
									</Table>
									{group.items.length + group.unindexed.length === 0 && (
										<p className="px-3 py-6 text-muted-foreground text-sm">
											{searchTerm ||
											statusFilters.length ||
											groupFilter.selected.length
												? "No Spaces match your search or filters."
												: "No Spaces in this group yet."}
										</p>
									)}
								</AppSidebarGroup>
							))}
					</div>
				)}
			</ScrollArea>
			<SpaceDirectoryPreview
				accountProfiles={input.accountProfiles}
				onClose={() => setPreview(null)}
				orgSlug={input.orgSlug}
				profileId={input.profileId}
				space={preview}
			/>
		</div>
	);
}

function resolveDirectoryLoadingState(
	discovering: boolean,
	sidebar: ReturnType<typeof useSidebarPreferences>
) {
	if (discovering) {
		return { loading: false, blockingError: false };
	}
	return {
		loading: sidebar.isPending,
		blockingError: sidebar.isError && !sidebar.preferences,
	};
}

function DirectoryGroupActions({
	alwaysVisible,
	group,
	sidebar,
	onSort,
}: {
	alwaysVisible?: boolean;
	group: {
		id: string;
		label: string;
		section?: AccountSidebarPreferences["spaces"];
	};
	sidebar: ReturnType<typeof useSidebarPreferences>;
	onSort: (sort: AccountSidebarPreferences["spaces"]["sort"]) => void;
}) {
	const preferences = sidebar.preferences;
	const custom = group.id !== "pinned" && group.id !== "spaces";
	const removeGroup = () => {
		if (preferences) {
			sidebar.save({
				...preferences,
				groups: preferences.groups.filter((entry) => entry.id !== group.id),
			});
		}
	};
	const createGroup = (name: string) => {
		if (preferences) {
			sidebar.save({
				...preferences,
				groups: [
					...preferences.groups,
					{ id: crypto.randomUUID(), name, sort: "priority", spaceIds: [] },
				],
			});
		}
	};
	return (
		<SidebarSectionActions
			alwaysVisible={alwaysVisible}
			disabled={sidebar.disabled}
			label={group.label}
			onDelete={custom ? removeGroup : undefined}
			onNewGroup={group.id === "spaces" ? createGroup : undefined}
			onSort={onSort}
			sort={group.section?.sort ?? "priority"}
		/>
	);
}

function UnindexedJoinedRow(input: {
	space: DirectorySpace;
	index: number;
	orgSlug: string;
	profileId: string;
}) {
	return (
		<TableRow className="border-0" index={input.index}>
			<TableCell className="py-4">
				<Link
					aria-label={`Open ${input.space.name}`}
					className="flex items-center gap-2 font-medium text-sm"
					to={buildOrganizationSpacePath({
						orgSlug: input.orgSlug,
						spaceId: input.space.spaceId,
						search: { profileId: input.profileId },
					})}
				>
					<ChatCircleTextIcon className="size-4 shrink-0 text-muted-foreground" />
					{input.space.name}
					<WelcomeSpaceLabel spaceId={input.space.spaceId} />
				</Link>
			</TableCell>
			<TableCell className="hidden lg:table-cell" />
			<TableCell className="hidden md:table-cell">
				{input.space.activeMemberCount ?? "—"}
			</TableCell>
			<TableCell />
			<TableCell />
		</TableRow>
	);
}

type DirectoryInput = React.ComponentProps<typeof SpaceDirectory>;
function JoinedRow(input: {
	item: AccountSpaceItem;
	index: number;
	preview: { text: string; timestamp: number } | null | undefined;
	summary?: SpaceSidebarActiveWakeSummary;
	unread: number;
	appearances: ReadonlyMap<string, SpaceMemberAppearance>;
	input: DirectoryInput;
	preferences?: AccountSidebarPreferences;
	save: (value: AccountSidebarPreferences) => void;
	disabled: boolean;
}) {
	const item = input.item;
	const href = buildOrganizationSpacePath({
		orgSlug: input.input.orgSlug,
		spaceId: item.spaceId,
		search: { profileId: item.openProfileId },
	});
	const status = input.summary
		? resolveSpaceActiveWakePresentation(input.summary)
		: null;
	const timestamp = resolveConversationTimestamp(
		input.preview?.timestamp,
		item.spaceCreatedAt
	);
	return (
		<TableRow
			className="group/directory-row border-0"
			data-space-id={item.spaceId}
			index={input.index}
		>
			<TableCell className="whitespace-normal py-4">
				<Link
					aria-label={`Open ${item.spaceName}`}
					className="block min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					to={href}
				>
					<span
						className={cn(
							"flex items-center gap-2 text-sm",
							input.unread ? "font-semibold text-foreground" : "font-medium"
						)}
					>
						<ChatCircleTextIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="truncate">{item.spaceName}</span>
						<WelcomeSpaceLabel spaceId={item.spaceId} />
						{item.visibility === "private" && (
							<LockKeyIcon
								aria-label="Invite-only in this organization"
								className="size-3 shrink-0 text-muted-foreground"
							/>
						)}
					</span>
					<span className="mt-1 block truncate pl-6 text-muted-foreground text-xs">
						{input.preview === undefined
							? "Message preview unavailable"
							: (input.preview?.text ?? item.spacePurpose ?? "No messages yet")}
					</span>
				</Link>
				<div className="mt-1 pl-6 lg:hidden">
					<RowStatus href={href} status={status} unread={input.unread} />
				</div>
			</TableCell>
			<TableCell className="hidden lg:table-cell">
				<RowStatus href={href} status={status} unread={input.unread} />
			</TableCell>
			<TableCell className="hidden md:table-cell">
				<MemberPreview
					appearances={input.appearances}
					item={item}
					orgSlug={input.input.orgSlug}
				/>
			</TableCell>
			<TableCell>
				{timestamp !== null && (
					<SidebarConversationTime timestamp={timestamp} />
				)}
			</TableCell>
			<TableCell>
				<DirectoryRowActions
					disabled={input.disabled || input.input.pinActionsPending}
					groupId={
						input.preferences?.groups.find((group) =>
							group.spaceIds.includes(item.spaceId)
						)?.id ?? "spaces"
					}
					groups={[
						{ id: "spaces", name: "Spaces" },
						...(input.preferences?.groups ?? []),
					]}
					moveDisabledReason={
						item.pinnedAt !== null
							? "Unpin this Space to move it to a group."
							: undefined
					}
					name={item.spaceName}
					onMove={(groupId) => {
						const preferences = input.preferences;
						if (!preferences) {
							return;
						}
						input.save({
							...preferences,
							groups: preferences.groups.map((entry) => ({
								...entry,
								spaceIds: [
									...entry.spaceIds.filter((id) => id !== item.spaceId),
									...(entry.id === groupId ? [item.spaceId] : []),
								],
							})),
						});
					}}
					onTogglePinned={() => input.input.onTogglePinned(item)}
					pinned={item.pinnedAt !== null}
				/>
			</TableCell>
		</TableRow>
	);
}

function RowStatus(input: {
	status: ReturnType<typeof resolveSpaceActiveWakePresentation> | null;
	unread: number;
	href: string;
}) {
	return (
		<div className="flex flex-col gap-1 text-xs">
			{input.status && (
				<Link
					className="flex items-center gap-2"
					title={input.status.label}
					to={input.href}
				>
					{input.status.orbState && (
						<SpaceAgentOrb state={input.status.orbState} />
					)}
					<span className="truncate">{input.status.label}</span>
				</Link>
			)}
			{input.unread > 0 && (
				<span className="flex items-center gap-2 text-muted-foreground">
					<span className="status-dot bg-unread" />
					{input.unread} unread
				</span>
			)}
		</div>
	);
}

function MemberPreview(input: {
	item: AccountSpaceItem;
	appearances: ReadonlyMap<string, SpaceMemberAppearance>;
	orgSlug: string;
}) {
	return (
		<Popover>
			<PopoverTrigger
				delay={250}
				openOnHover
				render={
					<Button
						aria-label={`Preview members of ${input.item.spaceName}`}
						className="max-w-full gap-1 px-0"
						size="sm"
						variant="ghost"
					/>
				}
			>
				{input.item.memberPreviews?.length ? (
					<SpaceMemberAvatars
						appearances={input.appearances}
						layout="horizontal"
						members={input.item.memberPreviews}
					/>
				) : (
					<UsersThreeIcon />
				)}
			</PopoverTrigger>
			<PopoverContent className="w-64 rounded-lg" side="top">
				<p className="px-2 font-medium">
					Members {input.item.activeMemberCount ?? ""}
				</p>
				{input.item.memberPreviews?.map((member) => (
					<Link
						className="flex items-center gap-3 rounded-md p-2 hover:bg-accent"
						key={member.profileId}
						to={buildProfilePath({
							orgSlug: input.orgSlug,
							profileId: member.profileId,
							profileKind: member.profileKind,
						})}
					>
						<SpaceMemberAvatars
							appearances={input.appearances}
							members={[member]}
						/>
						<span className="min-w-0 truncate">{member.profileName}</span>
					</Link>
				))}
				{(input.item.activeMemberCount ?? 0) >
					(input.item.memberPreviews?.length ?? 0) && (
					<Link
						className="p-2 text-muted-foreground"
						to={buildOrganizationSpacePath({
							orgSlug: input.orgSlug,
							spaceId: input.item.spaceId,
							search: { profileId: input.item.openProfileId },
						})}
					>
						Open Space to see all {input.item.activeMemberCount} members
					</Link>
				)}
			</PopoverContent>
		</Popover>
	);
}

function DiscoverList({
	spaces,
	input,
	onPreview,
	searching,
}: {
	spaces: readonly DirectorySpace[];
	input: DirectoryInput;
	onPreview: (space: DirectorySpace) => void;
	searching: boolean;
}) {
	if (spaces.length === 0) {
		return (
			<p className="px-3 py-12 text-center text-muted-foreground text-sm">
				{searching
					? "No Spaces match your search."
					: "No public Spaces to discover right now."}
			</p>
		);
	}
	return (
		<Table className="table-fixed">
			<TableHeader>
				<TableRow>
					<TableHead>Space</TableHead>
					<TableHead className="hidden w-28 sm:table-cell">Members</TableHead>
					<TableHead className="w-44">Explore</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{spaces.map((space, index) => (
					<TableRow className="border-0" index={index} key={space.spaceId}>
						<TableCell className="whitespace-normal py-5">
							<button
								className="flex items-center gap-2 text-left font-medium text-sm hover:underline"
								onClick={() => onPreview(space)}
								type="button"
							>
								<ChatCircleTextIcon className="size-4 shrink-0 text-muted-foreground" />
								{space.name}
							</button>
							{input.joinError?.spaceId === space.spaceId && (
								<p className="mt-2 text-destructive text-xs" role="alert">
									{input.joinError.message}
								</p>
							)}
						</TableCell>
						<TableCell className="hidden text-muted-foreground sm:table-cell">
							{space.activeMemberCount === null ? (
								<span>
									<span aria-hidden="true">—</span>
									<span className="sr-only">Member count unavailable</span>
								</span>
							) : (
								<span className="flex items-center gap-2">
									<UsersThreeIcon />
									{space.activeMemberCount}
								</span>
							)}
						</TableCell>
						<TableCell>
							<div className="flex items-center gap-2">
								<Button
									aria-label={`Preview ${space.name}`}
									onClick={() => onPreview(space)}
									size="sm"
									variant="ghost"
								>
									Preview
								</Button>
								<Button
									aria-label={`Join ${space.name}`}
									disabled={
										!input.canJoinSpaces ||
										input.pendingJoinSpaceId === space.spaceId
									}
									onClick={() => input.onJoinSpace(space.spaceId)}
									size="sm"
									variant="outline"
								>
									{input.pendingJoinSpaceId === space.spaceId
										? "Joining…"
										: "Join"}
								</Button>
							</div>
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
