import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuRadioGroup,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import {
	FluidDropdownMenuCheckboxItem as DropdownMenuCheckboxItem,
	FluidDropdownMenuSubTrigger as DropdownMenuSubTrigger,
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
	FluidDropdownMenuRadioItem,
	FluidDropdownMenuSubContent,
} from "@openmeld/ui/fluid/dropdown-menu";
import {
	ArchiveIcon,
	ChatCircleTextIcon,
	ClockIcon,
	CompassIcon,
	FolderIcon,
	FunnelSimpleIcon,
	ListIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	RobotIcon,
	SlidersHorizontalIcon,
	UsersIcon,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useMemo, useState } from "react";
import { useAgentRequestSpaceLabels } from "#/components/agent-access/agent-access-space-labels";
import { AppModuleSidebarHeader } from "#/components/app/app-module-sidebar-header";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { useActiveMemberAgentSessionList } from "#/components/member-agents/member-agent-session-nav";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationSpacesPath } from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { useDelayedPending } from "#/lib/use-delayed-pending";
import { AppContextualSidebarNav } from "../app/app-contextual-layout";
import { ControlledSidebarGroupStateProvider } from "../app/app-sidebar-group";
import { SidebarDrag, SidebarDropSection } from "../app/sidebar-drag";
import { useSidebarFilter } from "../app/sidebar-filter";
import { SidebarListSkeleton } from "../app/sidebar-list-skeleton";
import { SidebarNestedNavList } from "../app/sidebar-nested-nav-list";
import {
	SidebarSearchInput,
	useSidebarSearchDisclosure,
} from "../app/sidebar-search-input";
import { SidebarSectionActions } from "../app/sidebar-section-actions";
import { centerAgentEntryTitle } from "./center-agent-sidebar-entry";
import { ConversationSidebarMenu } from "./conversation-sidebar-menu";
import {
	type Conversation,
	type ConversationSection,
	conversationCategory,
} from "./conversation-sidebar-model";
import { ConversationSidebarRow } from "./conversation-sidebar-row";
import { NewChatDialog } from "./new-chat-dialog";
import { PinnedLayoutMenu, usePinnedLayout } from "./pinned-layout-menu";
import { SpaceCreationSidebar } from "./space-creation-sidebar";
import { resolveSpaceMemberAppearances } from "./space-member-avatars";
import { resolveSpaceStatusIndicators } from "./space-status-indicators";
import { useConversationDisclosure } from "./use-conversation-disclosure";
import {
	type ConversationView,
	useConversationView,
} from "./use-conversation-view";
import { useConversations } from "./use-conversations";
import { useMessagePreviews } from "./use-message-previews";
import { useSaveSidebarDisplaySnapshot } from "./use-save-sidebar-display-snapshot";
import { useSpaceDirectoryFilters } from "./use-space-directory-filters";
import { useUnreadHistoryPrefetch } from "./use-unread-history-prefetch";

/**
 * Indicators of one sidebar row. A MemberAgent row stands for several
 * Session Spaces, so it shows their combined unread, work and attention.
 */
function resolveConversationRowIndicators(
	item: Conversation,
	dm: ReturnType<typeof useConversations>["directMessages"]
) {
	// Every other row reads its own Space, exactly as before MemberAgents.
	return resolveSpaceStatusIndicators(
		item.memberAgentSessionIds ?? [item.spaceId],
		{ ...dm.indicators, attentionById: dm.attentionById }
	);
}

function getConversationFailures(
	dm: ReturnType<typeof useConversations>["directMessages"],
	hideAccountSpacesFailure: boolean
) {
	return [
		{
			label: "profile",
			isError:
				dm.needsDefaultHumanProfile &&
				!dm.profileId &&
				(dm.profilesQuery.isError || dm.profilesQuery.isSuccess),
			isFetching: dm.profilesQuery.isFetching,
			message: dm.profilesQuery.isError
				? "Couldn't load your profile."
				: "No Human Profile is available for this account.",
			retry: dm.profilesQuery.refetch,
		},
		{
			label: "sidebar settings",
			isError: dm.store.isError,
			isFetching: dm.store.isFetching,
			message: dm.store.preferences
				? "Couldn't refresh sidebar settings. Showing saved settings."
				: "Couldn't load sidebar settings.",
			retry: dm.store.retry,
		},
		{
			label: "conversations",
			isError: dm.spaces.isError && !hideAccountSpacesFailure,
			isFetching: dm.spaces.isFetching,
			message: dm.spaces.data
				? "Couldn't refresh conversations. Showing saved conversations."
				: "Couldn't load conversations.",
			retry: dm.spaces.refetch,
		},
		{
			label: "Center Agent conversations",
			isError: dm.sessions.isError,
			isFetching: dm.sessions.isFetching,
			message: dm.sessions.data
				? "Couldn't refresh Center Agent conversations. Showing saved conversations."
				: "Couldn't load Center Agent conversations.",
			retry: dm.sessions.refetch,
		},
		{
			label: "member information",
			isError: dm.directory.isError,
			isFetching: dm.directory.isFetching,
			message: dm.directory.data
				? "Couldn't refresh member information. Showing saved information."
				: "Couldn't load member information.",
			retry: dm.directory.refetch,
		},
	].filter((failure) => failure.isError);
}

function isConversationStatusEvidenceUnavailable(input: {
	activityUnavailable: boolean;
	inboxUnavailable: boolean;
	statuses: string[];
}): boolean {
	return (
		(input.statuses.includes("unread") && input.inboxUnavailable) ||
		(input.statuses.some((status) => status !== "unread") &&
			input.activityUnavailable)
	);
}

function shouldHoldConversationRows(input: {
	hasAccountIndex: boolean;
	isAccountIndexPending: boolean;
}): boolean {
	return input.isAccountIndexPending && !input.hasAccountIndex;
}

function useConversationReadState(
	dm: ReturnType<typeof useConversations>["directMessages"],
	waitingForActivity: boolean
) {
	const waitingForProfile =
		dm.needsDefaultHumanProfile && dm.profilesQuery.isPending;
	const waitingForSpaces = dm.spaces.isPending && !!dm.profileId;
	const waitingForSessions = dm.sessions.isPending && !!dm.profileId;
	const pending =
		waitingForProfile ||
		waitingForSpaces ||
		waitingForSessions ||
		(dm.store.isPending && !dm.store.preferences) ||
		waitingForActivity;
	const paused =
		(waitingForProfile && dm.profilesQuery.fetchStatus === "paused") ||
		(waitingForSpaces && dm.spaces.fetchStatus === "paused") ||
		(waitingForSessions && dm.sessions.fetchStatus === "paused");
	const showDelayedPending = useDelayedPending(pending && !paused);
	return { pending, paused, showDelayedPending };
}

function ConversationsSidebarSearch(input: {
	disclosure: ReturnType<typeof useSidebarSearchDisclosure>;
	home?: boolean;
	visible: boolean;
	value: string;
	onValueChange: (value: string) => void;
}) {
	if (input.home) {
		return (
			<div className="relative mx-1 mb-3">
				<MagnifyingGlassIcon
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					aria-label="Search conversations"
					className="pl-8"
					onChange={(event) => input.onValueChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							input.onValueChange("");
						}
					}}
					placeholder="Search conversations"
					ref={input.disclosure.inputRef}
					type="search"
					value={input.value}
				/>
			</div>
		);
	}
	if (!(input.visible && input.disclosure.open)) {
		return null;
	}
	return (
		<div className="mb-2 px-1">
			<SidebarSearchInput
				inputClassName="lg:h-7"
				inputRef={input.disclosure.inputRef}
				label="Search conversations"
				onOpenChange={input.disclosure.onOpenChange}
				onValueChange={input.onValueChange}
				open={input.disclosure.open}
				placeholder="Search conversations"
				value={input.value}
			/>
		</div>
	);
}

function collapsedEntryTitle(search: string, viewerName?: string) {
	return search.trim() ? undefined : centerAgentEntryTitle(viewerName);
}

// The open MemberAgent's chats nest under its row in a list section. Filters
// and search narrow the conversation list; the chats return when cleared.
function nestsMemberAgentSessions(input: {
	item: Conversation;
	selected: string | null | undefined;
	memberAgentId: string | undefined;
	layout: "grid" | "list";
	hasFilters: boolean;
}) {
	return (
		!input.hasFilters &&
		input.layout === "list" &&
		Boolean(input.memberAgentId) &&
		input.item.memberAgentId === input.memberAgentId &&
		input.item.spaceId === input.selected
	);
}

// The collapsed Center Agent entry stands for several chats, so it has no
// per-chat rename or archive action.
function isSingleChat(
	item: Conversation
): item is Extract<Conversation, { kind: "direct-message" }> {
	// A MemberAgent row stands for several Sessions; their dedicated Session
	// operations live in the Direct Message header, not personal archive/rename.
	return (
		item.kind === "direct-message" &&
		!item.sessionSpaceIds &&
		!item.memberAgentId
	);
}

function resolveConversationSections(
	stored: readonly ConversationSection[],
	view: ConversationView
) {
	const savedOrder = stored.find((section) => section.id === "spaces");
	const recent: ConversationSection = {
		id: "recent",
		name: "Recent",
		kind: "space",
		sort: view === "grouped" ? (savedOrder?.sort ?? "priority") : "recent",
		spaceIds: savedOrder?.spaceIds ?? [],
	};
	const all = [
		...stored.filter((section) => section.id === "pinned" || section.groupId),
		recent,
	];
	const displayed =
		view === "grouped" ? all : all.filter((section) => !section.groupId);
	return { all, displayed, recent };
}

export function ConversationsSidebar(
	input: {
		currentProfileId?: string;
		currentSpaceId?: string;
		home?: boolean;
		hideAccountSpacesFailure?: boolean;
		showSearch?: boolean;
	} = {}
) {
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const [search, setSearch] = useState("");
	// Searching lists each Center Agent chat on its own row, so a match on an
	// older chat's title opens that chat rather than the entry's latest one.
	const model = useConversations({
		...input,
		centerAgentEntryTitle: collapsedEntryTitle(
			search,
			defaultHumanProfile?.profileName
		),
	});
	const { dismiss } = useAppNavigationPresentation();
	const onNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
		if (!(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) {
			dismiss();
		}
	};
	const { directMessages: dm } = model;
	useSaveSidebarDisplaySnapshot({
		organizationId: dm.org.id,
		profileId: dm.profileId,
	});
	const agentRequestLabels = useAgentRequestSpaceLabels();
	const memberAppearances = useMemo(
		() => resolveSpaceMemberAppearances(dm.directory.data),
		[dm.directory.data]
	);
	const { currentUserId } = useAppOrganization();
	useUnreadHistoryPrefetch({
		accountId: currentUserId,
		organizationId: dm.org.id,
		activeSpaceId: model.selected,
		conversations: model.conversations,
		unread: dm.indicators.unreadBySpaceId,
	});
	const { view, setView } = useConversationView(currentUserId, dm.org.id);
	const searchDisclosure = useSidebarSearchDisclosure();
	const [archived, setArchived] = useState(false);
	const [creating, setCreating] = useState(false);
	const [renaming, setRenaming] = useState<Conversation | null>(null);
	const [name, setName] = useState("");
	const navigate = useNavigate();
	const kinds = useSidebarFilter(
		[
			{ id: "space", label: "Groups", icon: ChatCircleTextIcon },
			{ id: "human", label: "People", icon: UsersIcon },
			{ id: "agent", label: "Agents", icon: RobotIcon },
		],
		"All conversations"
	);
	const {
		all: allSections,
		displayed: sections,
		recent: recentSection,
	} = resolveConversationSections(model.sections, view);
	const owner = (item: Conversation) => {
		const id = model.owner(item);
		return id === "spaces" || id === "chats" ? "recent" : id;
	};
	const displaySection = (item: Conversation) => {
		const id = owner(item);
		return view === "recent" && id !== "pinned" ? "recent" : id;
	};
	const filter = useSpaceDirectoryFilters(
		allSections.map((section) => ({ id: section.id, label: section.name })),
		() =>
			document
				.querySelector<HTMLInputElement>(
					'input[aria-label="Search conversations"]'
				)
				?.focus(),
		"Search conversations"
	);
	const statusEvidenceUnavailable = isConversationStatusEvidenceUnavailable({
		activityUnavailable: dm.indicators.activityUnavailable,
		inboxUnavailable: dm.inbox.isPending || dm.inbox.isError,
		statuses: filter.statuses,
	});
	const active = model.conversations.find(
		(item) => item.spaceId === model.selected
	);
	const activeSection = active ? displaySection(active) : null;
	const memberAgentSessionList = useActiveMemberAgentSessionList(active, {
		...dm.indicators,
		attentionById: dm.attentionById,
	});
	const { showMessagePreviews, setShowMessagePreviews } = useMessagePreviews(
		dm.profileId,
		dm.org.id
	);
	const { pinnedLayout, setPinnedLayout } = usePinnedLayout(
		dm.profileId,
		dm.org.id
	);
	const disclosure = useConversationDisclosure(
		dm.profileId,
		dm.org.id,
		model.selected,
		activeSection,
		!!search.trim() || filter.active
	);
	// The account index is the source for ordinary Spaces. Keep session-only
	// discovery from appearing to be the complete sidebar before it resolves.
	const discoverableConversations = shouldHoldConversationRows({
		hasAccountIndex: Boolean(dm.spaces.data),
		isAccountIndexPending: dm.spaces.isPending,
	})
		? []
		: model.conversations;
	const filtered = discoverableConversations.filter(
		(item) =>
			kinds.includes(conversationCategory(item)) &&
			(item.kind === "direct-message"
				? dm.isArchived(item.chat) === archived
				: !archived) &&
			item.title
				.toLocaleLowerCase()
				.includes(search.trim().toLocaleLowerCase()) &&
			filter.includes(owner(item)) &&
			(statusEvidenceUnavailable ||
				filter.matchesStatus(
					dm.indicators.unreadBySpaceId.get(item.spaceId)?.unreadCount ?? 0,
					dm.indicators.activeWakeSummaryBySpaceId.get(item.spaceId)
				))
	);
	const waitingForActivity =
		sections.some((section) => section.sort === "priority") &&
		dm.indicators.isPending;
	const sectionRows = new Map(
		sections.map((section) => [
			section.id,
			section.sort === "priority" && waitingForActivity
				? []
				: model.sort(
						filtered.filter((item) => displaySection(item) === section.id),
						section
					),
		])
	);
	const rows = (section: ConversationSection) =>
		sectionRows.get(section.id) ?? [];
	const unreadCount = (section: ConversationSection) =>
		rows(section).reduce(
			(count, item) =>
				count +
				(dm.indicators.unreadBySpaceId.get(item.spaceId)?.unreadCount ?? 0),
			0
		);
	const hasFilters = Boolean(
		search.trim() || filter.active || kinds.selected.length > 0 || archived
	);
	const visible = sections.filter(
		(section) =>
			rows(section).length > 0 ||
			(view === "grouped" && section.id !== "pinned" && !hasFilters)
	);
	const { pending, paused, showDelayedPending } = useConversationReadState(
		dm,
		waitingForActivity
	);
	const failures = getConversationFailures(
		dm,
		input.hideAccountSpacesFailure === true
	);
	const failed = failures.length > 0;
	const moveTarget = (id: string, sectionId: string) => {
		if (sectionId !== "recent") {
			return sectionId;
		}
		const item = model.conversations.find(
			(conversation) => conversation.spaceId === id
		);
		return item?.kind === "direct-message" ? "chats" : "spaces";
	};
	const move = (
		sectionId: string,
		id: string,
		beforeId?: string,
		prepend = false
	) => {
		const targetId = moveTarget(id, sectionId);
		const target = model.sections.find((section) => section.id === targetId);
		if (!target) {
			return Promise.resolve();
		}
		if (sectionId === "recent") {
			return model.move(targetId, id, target.spaceIds);
		}
		const visibleIds = prepend
			? [
					...new Set([
						...target.spaceIds,
						...model
							.sort(
								model.conversations.filter(
									(item) => model.owner(item) === targetId
								),
								target
							)
							.map((item) => item.spaceId),
					]),
				]
			: rows(target).map((item) => item.spaceId);
		return model.move(
			targetId,
			id,
			visibleIds,
			prepend ? visibleIds.find((value) => value !== id) : beforeId
		);
	};
	const viewMenu = (
		<>
			<DropdownMenuRadioGroup
				onValueChange={(value) => {
					if (value === "grouped" || value === "recent") {
						setView(value);
					}
				}}
				value={view}
			>
				<FluidDropdownMenuRadioItem closeOnClick index={0} value="grouped">
					<FolderIcon /> Grouped
				</FluidDropdownMenuRadioItem>
				<FluidDropdownMenuRadioItem closeOnClick index={1} value="recent">
					<ClockIcon /> Recent
				</FluidDropdownMenuRadioItem>
			</DropdownMenuRadioGroup>
		</>
	);
	const previewMenu = (
		<DropdownMenuCheckboxItem
			checked={showMessagePreviews}
			index={3}
			onCheckedChange={setShowMessagePreviews}
		>
			<ChatCircleTextIcon /> Show message previews
		</DropdownMenuCheckboxItem>
	);
	const filterMenu = (
		<>
			{kinds.menu}
			<DropdownMenuSeparator />
			{filter.menu}
			<DropdownMenuSeparator />
			<DropdownMenuCheckboxItem
				checked={archived}
				index={0}
				onCheckedChange={setArchived}
			>
				<ArchiveIcon /> Archived direct messages
			</DropdownMenuCheckboxItem>
		</>
	);
	return (
		<>
			<AppModuleSidebarHeader
				title={
					<Link
						className="flex min-w-0 items-center rounded-sm font-medium text-sm focus-visible:outline-2"
						onClick={onNavigate}
						to={buildOrganizationSpacesPath(dm.org.slug)}
					>
						Messages
					</Link>
				}
			>
				<div className="ml-auto flex shrink-0 items-center gap-1">
					<Button
						aria-label="New message"
						onClick={() => setCreating(true)}
						size="icon-sm"
						title="New message"
						variant="ghost"
					>
						<PlusIcon aria-hidden="true" />
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									aria-label="View and filters"
									onClick={searchDisclosure.rememberTrigger}
									size="icon-sm"
									variant="ghost"
								/>
							}
						>
							<SlidersHorizontalIcon />
						</DropdownMenuTrigger>
						<FluidDropdownMenuContent
							align="end"
							className="w-56"
							finalFocus={searchDisclosure.finalFocus}
						>
							<FluidDropdownMenuItem
								index={0}
								onClick={searchDisclosure.reveal}
							>
								<MagnifyingGlassIcon /> Search
							</FluidDropdownMenuItem>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger index={1}>
									<ListIcon aria-hidden="true" />
									Conversation view
								</DropdownMenuSubTrigger>
								<FluidDropdownMenuSubContent className="w-44">
									{viewMenu}
								</FluidDropdownMenuSubContent>
							</DropdownMenuSub>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger index={2}>
									<FunnelSimpleIcon aria-hidden="true" />
									Filter conversations
								</DropdownMenuSubTrigger>
								<FluidDropdownMenuSubContent className="w-60 max-w-[calc(100vw-2rem)]">
									{filterMenu}
								</FluidDropdownMenuSubContent>
							</DropdownMenuSub>
							{previewMenu}
							{dm.org.isPersonal !== true && (
								<FluidDropdownMenuItem
									index={4}
									onClick={() => {
										dismiss();
										navigate({
											search: { view: "discover" },
											to: buildOrganizationSpacesPath(dm.org.slug),
										}).catch(console.error);
									}}
								>
									<CompassIcon aria-hidden="true" /> Discover
								</FluidDropdownMenuItem>
							)}
						</FluidDropdownMenuContent>
					</DropdownMenu>
				</div>
			</AppModuleSidebarHeader>
			<ConversationsSidebarSearch
				disclosure={searchDisclosure}
				home={input.home}
				onValueChange={setSearch}
				value={search}
				visible={input.showSearch !== false}
			/>
			{filter.badges}
			{kinds.badges}
			{archived && (
				<Button onClick={() => setArchived(false)} size="sm" variant="ghost">
					Archived direct messages · Clear
				</Button>
			)}
			{failures.map((failure) => (
				<div className="flex items-start gap-1 px-2 py-1" key={failure.label}>
					<output className="min-w-0 flex-1 py-1 text-muted-foreground text-xs">
						{failure.message}
					</output>
					<Button
						aria-label={`Retry ${failure.label}`}
						disabled={failure.isFetching}
						onClick={() => failure.retry()}
						size="sm"
						variant="ghost"
					>
						Retry
					</Button>
				</div>
			))}
			{paused && !failed && (
				<p className="px-2 py-1 text-muted-foreground text-xs">
					Connect to the internet to load conversations.
				</p>
			)}
			{statusEvidenceUnavailable ? (
				<p className="px-2 py-1 text-muted-foreground text-xs">
					Status filters are unavailable. Showing conversations without them.
				</p>
			) : null}
			{showDelayedPending &&
				!paused &&
				filtered.length === 0 &&
				!hasFilters && (
					<SidebarListSkeleton
						label="Loading conversations"
						rowCount={2}
						showPreview
					/>
				)}
			{[pending, failed, dm.sessions.hasNextPage, filtered.length > 0].every(
				(value) => !value
			) && (
				<div className="p-2 text-muted-foreground text-xs">
					<p>
						{hasFilters
							? "No conversations match your search or filters."
							: "No conversations yet."}
					</p>
				</div>
			)}
			<SpaceCreationSidebar
				onNavigate={onNavigate}
				organizationId={dm.org.id}
				orgSlug={dm.org.slug}
				profileId={dm.profileId}
				spaceIds={model.conversations.map(
					(conversation) => conversation.spaceId
				)}
			/>
			{dm.sessions.isFetchingNextPage && (
				<p aria-live="polite" className="px-2 text-muted-foreground text-xs">
					Loading older direct messages…
				</p>
			)}
			<SidebarDrag
				canDrop={(id, section) => {
					if (view !== "grouped") {
						return section === "pinned" && model.canMove(id, section);
					}
					if (
						section === "recent" &&
						rows(recentSection).some((item) => item.spaceId === id)
					) {
						return false;
					}
					return model.canMove(id, moveTarget(id, section));
				}}
				groupIds={
					view === "grouped" && !model.disabled
						? model.sections
								.filter((section) => section.groupId)
								.map((section) => section.id)
						: []
				}
				onMove={move}
				onMoveGroup={model.moveFolder}
			>
				<ControlledSidebarGroupStateProvider value={disclosure}>
					<AppContextualSidebarNav
						activeItemId={model.selected}
						ariaLabel="Conversations"
						groups={[
							...visible.map((section) => ({
								id: section.id,
								label: section.name,
								ariaLabel: section.name,
								onRename: section.groupId
									? (value: string) =>
											model.updateSection(section, { name: value })
									: undefined,
								labelAccessory: (
									<>
										{!disclosure.isOpen(section.id) &&
											unreadCount(section) > 0 && (
												<span className="mr-1 text-muted-foreground text-xs">
													{unreadCount(section)} unread
												</span>
											)}
										{section.id === "pinned" && (
											<PinnedLayoutMenu
												layout={pinnedLayout}
												onLayoutChange={setPinnedLayout}
											/>
										)}
										{view === "grouped" && section.id === "recent" && (
											<SidebarSectionActions
												alwaysVisible
												disabled={model.disabled}
												groupNoun="folder"
												label={section.name}
												onNewGroup={model.addFolder}
												onSort={(sort) =>
													model.updateSection(section, { sort })
												}
												sort={section.sort}
												sortOptions={[
													["priority", "Priority"],
													["recent", "Recent activity"],
												]}
											/>
										)}
										{section.groupId && (
											<SidebarSectionActions
												disabled={model.disabled}
												groupNoun="folder"
												label={section.name}
												onDelete={() => model.updateSection(section, null)}
												onSort={(sort) =>
													model.updateSection(section, { sort })
												}
												sort={section.sort}
											/>
										)}
									</>
								),
								content: (
									<SidebarDropSection
										ids={rows(section).map((item) => item.spaceId)}
										layout={section.id === "pinned" ? pinnedLayout : "list"}
										section={section.id}
									>
										<ConversationSidebarMenu
											activeLayoutId="conversation-selection"
											// The open chat is highlighted among the nested chats instead.
											activeValue={
												rows(section).some((item) =>
													nestsMemberAgentSessions({
														item,
														selected: model.selected,
														memberAgentId:
															memberAgentSessionList?.memberAgentId,
														layout:
															section.id === "pinned" ? pinnedLayout : "list",
														hasFilters,
													})
												)
													? null
													: model.selected
											}
											aria-label={section.name}
											layout={section.id === "pinned" ? pinnedLayout : "list"}
											updateIndices={rows(section).flatMap((item, index) => {
												const indicators = resolveConversationRowIndicators(
													item,
													dm
												);
												return indicators.unreadCount > 0 ||
													indicators.activeWakeSummary ||
													indicators.attentionTone
													? [index]
													: [];
											})}
										>
											{rows(section).map((item, index) => {
												const indicators = resolveConversationRowIndicators(
													item,
													dm
												);
												return (
													<ConversationSidebarRow
														activeWakeSummary={indicators.activeWakeSummary}
														agentRequestLabel={agentRequestLabels.get(
															item.spaceId
														)}
														archived={archived}
														attentionTone={indicators.attentionTone}
														conversation={item}
														disabled={model.disabled}
														dragDisabled={false}
														groups={model.moveGroups}
														index={index}
														key={item.spaceId}
														layout={
															section.id === "pinned" ? pinnedLayout : "list"
														}
														memberAppearances={memberAppearances}
														messageUnreadCount={indicators.messageUnreadCount}
														nestedNavigation={
															memberAgentSessionList &&
															nestsMemberAgentSessions({
																item,
																selected: model.selected,
																memberAgentId:
																	memberAgentSessionList.memberAgentId,
																layout:
																	section.id === "pinned"
																		? pinnedLayout
																		: "list",
																hasFilters,
															}) ? (
																<SidebarNestedNavList
																	activeItemId={model.selected ?? null}
																	ariaLabel={`Chats with ${item.title}`}
																	className="ml-[21px]"
																	sections={memberAgentSessionList.sections}
																/>
															) : undefined
														}
														onArchive={
															isSingleChat(item)
																? () => dm.setArchived(item.chat, !archived)
																: undefined
														}
														onMove={(target) =>
															move(
																target,
																item.spaceId,
																undefined,
																target === "pinned"
															).catch(console.error)
														}
														onRename={
															isSingleChat(item)
																? () => {
																		setRenaming(item);
																		setName(item.title);
																	}
																: undefined
														}
														onUnpin={() =>
															model.unpin(item).catch(console.error)
														}
														profileId={item.profileId}
														section={section.id}
														selected={model.selected === item.spaceId}
														showMessagePreviews={showMessagePreviews}
														title={item.title}
														unreadCount={indicators.unreadCount}
														url={item.url}
													/>
												);
											})}
										</ConversationSidebarMenu>
									</SidebarDropSection>
								),
							})),
						]}
						placement="main"
						title="Conversations"
					/>
				</ControlledSidebarGroupStateProvider>
			</SidebarDrag>
			{creating && (
				<NewChatDialog
					initialQuery={search.trim()}
					onOpenChange={setCreating}
					open={creating}
				/>
			)}
			<Dialog
				onOpenChange={(open) => {
					if (!open) {
						setRenaming(null);
					}
				}}
				open={renaming !== null}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename direct message</DialogTitle>
					</DialogHeader>
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (!(renaming && name.trim()) || model.disabled) {
								return;
							}
							dm.save({
								...dm.preferences,
								titles: {
									...dm.preferences.titles,
									[renaming.spaceId]: name.trim(),
								},
							});
							setRenaming(null);
						}}
					>
						<Input
							aria-label="Conversation name"
							autoFocus
							maxLength={160}
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
						<Button disabled={model.disabled || !name.trim()} type="submit">
							Save
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
