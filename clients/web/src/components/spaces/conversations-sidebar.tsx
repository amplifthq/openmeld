import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	ContextMenu,
	ContextMenuTrigger,
} from "@openmeld/ui/components/context-menu";
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
	FluidDropdownMenuContent as DropdownMenuContent,
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
	DotsThreeIcon,
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
import {
	type MouseEvent,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useAgentRequestSpaceLabels } from "#/components/agent-access/agent-access-space-labels";
import { AppModuleSidebarHeader } from "#/components/app/app-module-sidebar-header";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { useActiveMemberAgentSessionList } from "#/components/member-agents/member-agent-session-nav";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationNewSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { useDelayedPending } from "#/lib/use-delayed-pending";
import { AppContextualSidebarNav } from "../app/app-contextual-layout";
import { ControlledSidebarGroupStateProvider } from "../app/app-sidebar-group";
import { SidebarDrag, SidebarDropSection } from "../app/sidebar-drag";
import { moveSidebarGroup } from "../app/sidebar-drop-target";
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
import { useConversationView } from "./use-conversation-view";
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

function isSpaceEmptyStateVisible(
	view: string,
	unavailable: boolean,
	conversations: Conversation[]
) {
	return (
		view === "grouped" &&
		!unavailable &&
		!conversations.some((item) => item.kind === "space")
	);
}

function SpaceSidebarEmptyState({
	visible,
	sectionId,
	orgSlug,
	onNavigate,
}: {
	visible: boolean;
	sectionId: string;
	orgSlug: string;
	onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
	if (!visible || sectionId !== "spaces") {
		return null;
	}
	return (
		<div className="mx-1 flex min-h-24 items-center justify-center rounded-md border border-border/70 border-dashed bg-card/25 px-3 py-5">
			<Link
				className={buttonVariants({
					size: "sm",
					variant: "outline",
				})}
				onClick={onNavigate}
				to={buildOrganizationNewSpacePath(orgSlug)}
			>
				<PlusIcon aria-hidden="true" />
				New Space
			</Link>
		</div>
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

function isConversationListIncomplete(input: {
	failed: boolean;
	hasFilters: boolean;
	hasNextPage: boolean;
	pending: boolean;
}): boolean {
	return input.pending || input.failed || input.hasFilters || input.hasNextPage;
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
	visible: boolean;
	value: string;
	onValueChange: (value: string) => void;
}) {
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
				placeholder="Find a space..."
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
function isSingleChat(item: Conversation) {
	// A MemberAgent row stands for several Sessions; their dedicated Session
	// operations live in the Direct Message header, not personal archive/rename.
	return (
		item.kind === "direct-message" &&
		!item.sessionSpaceIds &&
		!item.memberAgentId
	);
}

export function ConversationsSidebar(
	input: {
		currentProfileId?: string;
		currentSpaceId?: string;
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
	const { headerRef, titleRef, actionsRef, compactActions } =
		useHeaderActionOverflow();
	const [archived, setArchived] = useState(false);
	const [creating, setCreating] = useState(false);
	const [newMessageQuery, setNewMessageQuery] = useState("");
	const [creatingGroup, setCreatingGroup] = useState<string>();
	const [renaming, setRenaming] = useState<Conversation | null>(null);
	const [name, setName] = useState("");
	const navigate = useNavigate();
	const kinds = useSidebarFilter(
		[
			{ id: "space", label: "Spaces", icon: ChatCircleTextIcon },
			{ id: "human", label: "People", icon: UsersIcon },
			{ id: "agent", label: "Agents", icon: RobotIcon },
		],
		"All conversations"
	);
	const filter = useSpaceDirectoryFilters(
		model.sections.map((section) => ({ id: section.id, label: section.name })),
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
	const activeSection = active ? model.owner(active) : null;
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
				? dm.preferences.archivedIds.includes(item.spaceId) === archived
				: !archived) &&
			item.title
				.toLocaleLowerCase()
				.includes(search.trim().toLocaleLowerCase()) &&
			filter.includes(model.owner(item)) &&
			(statusEvidenceUnavailable ||
				filter.matchesStatus(
					dm.indicators.unreadBySpaceId.get(item.spaceId)?.unreadCount ?? 0,
					dm.indicators.activeWakeSummaryBySpaceId.get(item.spaceId)
				))
	);
	const recentSection: ConversationSection = {
		id: "recent",
		name: "Recent",
		kind: "space" as const,
		sort: "recent" as const,
		spaceIds: [],
	};
	const sections =
		view === "recent"
			? [
					...model.sections.filter((section) => section.id === "pinned"),
					recentSection,
				]
			: model.sections;
	const waitingForActivity = view === "grouped" && dm.indicators.isPending;
	const rows = (section: ConversationSection) => {
		if (section.sort === "priority" && waitingForActivity) {
			return [];
		}
		return model.sort(
			filtered.filter((item) =>
				section.id === "recent"
					? model.owner(item) !== "pinned"
					: model.owner(item) === section.id
			),
			section
		);
	};
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
			(view === "grouped" &&
				section.id !== "pinned" &&
				section.id !== "chats" &&
				!hasFilters)
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
	const showSpaceEmptyState = isSpaceEmptyStateVisible(
		view,
		isConversationListIncomplete({
			failed,
			hasFilters,
			hasNextPage: Boolean(dm.sessions.hasNextPage),
			pending,
		}),
		model.conversations
	);
	const move = (
		sectionId: string,
		id: string,
		beforeId?: string,
		prepend = false
	) => {
		const target = model.sections.find((section) => section.id === sectionId);
		if (!target) {
			return Promise.resolve();
		}
		const visibleIds = prepend
			? [
					...new Set([
						...target.spaceIds,
						...model
							.sort(
								model.conversations.filter(
									(item) => model.owner(item) === sectionId
								),
								target
							)
							.map((item) => item.spaceId),
					]),
				]
			: rows(target).map((item) => item.spaceId);
		return model.move(
			sectionId,
			id,
			visibleIds,
			prepend ? visibleIds.find((value) => value !== id) : beforeId
		);
	};
	const newMessage = (groupId?: string, query = "") => {
		setNewMessageQuery(query);
		setCreatingGroup(groupId);
		setCreating(true);
	};
	const newItem = (section: ConversationSection) => {
		if (section.kind === "space") {
			navigate({ to: buildOrganizationNewSpacePath(dm.org.slug) }).catch(
				console.error
			);
		} else {
			newMessage(section.groupId ? section.id : undefined);
		}
	};
	const creationMenu = (
		<>
			<FluidDropdownMenuItem index={0} onClick={() => newMessage()}>
				<ChatCircleTextIcon />
				New message
			</FluidDropdownMenuItem>
			<FluidDropdownMenuItem
				index={1}
				onClick={() => {
					dismiss();
					navigate({ to: buildOrganizationNewSpacePath(dm.org.slug) }).catch(
						console.error
					);
				}}
			>
				<PlusIcon />
				New Space
			</FluidDropdownMenuItem>
		</>
	);
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
			index={2}
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
				ref={headerRef}
				title={
					<SpacesDirectoryLink onNavigate={onNavigate} orgSlug={dm.org.slug} />
				}
				titleRef={titleRef}
			>
				<div
					className={
						compactActions
							? "pointer-events-none invisible absolute right-0 flex w-max items-center gap-1"
							: "ml-auto flex shrink-0 items-center gap-1"
					}
					inert={compactActions}
					ref={actionsRef}
				>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									aria-label="New conversation"
									size="icon-sm"
									variant="ghost"
								/>
							}
						>
							<PlusIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{creationMenu}
						</DropdownMenuContent>
					</DropdownMenu>
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
								index={3}
								onClick={searchDisclosure.reveal}
							>
								<MagnifyingGlassIcon /> Search
							</FluidDropdownMenuItem>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger index={0}>
									<ListIcon aria-hidden="true" />
									Conversation view
								</DropdownMenuSubTrigger>
								<FluidDropdownMenuSubContent className="w-44">
									{viewMenu}
								</FluidDropdownMenuSubContent>
							</DropdownMenuSub>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger index={1}>
									<FunnelSimpleIcon aria-hidden="true" />
									Filter conversations
								</DropdownMenuSubTrigger>
								<FluidDropdownMenuSubContent className="w-60 max-w-[calc(100vw-2rem)]">
									{filterMenu}
								</FluidDropdownMenuSubContent>
							</DropdownMenuSub>
							{previewMenu}
						</FluidDropdownMenuContent>
					</DropdownMenu>
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								aria-label="Spaces actions"
								className="ml-auto hidden shrink-0 data-[compact=true]:inline-flex"
								data-compact={compactActions}
								onClick={searchDisclosure.rememberTrigger}
								size="icon-sm"
								variant="ghost"
							/>
						}
					>
						<DotsThreeIcon />
					</DropdownMenuTrigger>
					<FluidDropdownMenuContent
						align="start"
						className="w-56"
						finalFocus={searchDisclosure.finalFocus}
					>
						<FluidDropdownMenuItem index={4} onClick={searchDisclosure.reveal}>
							<MagnifyingGlassIcon /> Search
						</FluidDropdownMenuItem>
						<DropdownMenuSub>
							<DropdownMenuSubTrigger index={3}>
								<PlusIcon aria-hidden="true" />
								New conversation
							</DropdownMenuSubTrigger>
							<FluidDropdownMenuSubContent className="w-60">
								{creationMenu}
							</FluidDropdownMenuSubContent>
						</DropdownMenuSub>
						<DropdownMenuSub>
							<DropdownMenuSubTrigger index={0}>
								<ListIcon aria-hidden="true" />
								Conversation view
							</DropdownMenuSubTrigger>
							<FluidDropdownMenuSubContent className="w-60">
								{viewMenu}
							</FluidDropdownMenuSubContent>
						</DropdownMenuSub>
						<DropdownMenuSub>
							<DropdownMenuSubTrigger index={1}>
								<FunnelSimpleIcon aria-hidden="true" />
								Filter conversations
							</DropdownMenuSubTrigger>
							<FluidDropdownMenuSubContent className="w-60">
								{filterMenu}
							</FluidDropdownMenuSubContent>
						</DropdownMenuSub>
						{previewMenu}
					</FluidDropdownMenuContent>
				</DropdownMenu>
			</AppModuleSidebarHeader>
			<ConversationsSidebarSearch
				disclosure={searchDisclosure}
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
			{[
				pending,
				failed,
				dm.sessions.hasNextPage,
				showSpaceEmptyState,
				filtered.length > 0,
			].every((value) => !value) && (
				<div className="p-2 text-muted-foreground text-xs">
					<p>
						{hasFilters
							? "No conversations match your search or filters."
							: "No conversations yet."}
					</p>
					<Button
						className="mt-2"
						onClick={() => newMessage(undefined, search.trim())}
						size="sm"
						variant="outline"
					>
						Find someone
					</Button>
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
			<ContextMenu>
				<ContextMenuTrigger
					className="select-auto"
					render={<div className="contents" />}
				>
					<SidebarDrag
						canDrop={(id, section) =>
							view === "grouped"
								? model.canMove(id, section)
								: section === "pinned" && model.canMove(id, section)
						}
						groupIds={
							view === "grouped" && !model.disabled
								? model.sections
										.filter((section) => section.groupId)
										.map((section) => section.id)
								: []
						}
						onMove={move}
						onMoveGroup={(id, before) => {
							const section = model.sections.find((item) => item.id === id);
							const target = model.sections.find((item) => item.id === before);
							if (
								!section?.groupId ||
								(target && target.kind !== section.kind) ||
								!dm.store.preferences
							) {
								return;
							}
							if (section.kind === "space") {
								dm.store.save({
									...dm.store.preferences,
									groups: moveSidebarGroup(
										dm.store.preferences.groups,
										section.groupId,
										target?.groupId
									),
								});
							} else {
								dm.save({
									...dm.preferences,
									groups: moveSidebarGroup(
										dm.preferences.groups,
										section.groupId,
										target?.groupId
									),
								});
							}
						}}
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
												{view === "grouped" && section.id !== "pinned" && (
													<SidebarSectionActions
														addLabel={
															section.kind === "space"
																? "Add Space or group"
																: "Add direct message or group"
														}
														disabled={model.disabled}
														label={section.name}
														newItemLabel={
															section.kind === "space"
																? "New Space"
																: "New direct message"
														}
														onDelete={
															section.groupId
																? () => model.updateSection(section, null)
																: undefined
														}
														onNewGroup={(value) => {
															if (section.kind !== "pinned") {
																model.addGroup(section.kind, value);
															}
														}}
														onNewItem={() => newItem(section)}
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
												<SpaceSidebarEmptyState
													onNavigate={onNavigate}
													orgSlug={dm.org.slug}
													sectionId={section.id}
													visible={showSpaceEmptyState}
												/>
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
																	section.id === "pinned"
																		? pinnedLayout
																		: "list",
																hasFilters,
															})
														)
															? null
															: model.selected
													}
													aria-label={section.name}
													layout={
														section.id === "pinned" ? pinnedLayout : "list"
													}
													updateIndices={rows(section).flatMap(
														(item, index) => {
															const indicators =
																resolveConversationRowIndicators(item, dm);
															return indicators.unreadCount > 0 ||
																indicators.activeWakeSummary ||
																indicators.attentionTone
																? [index]
																: [];
														}
													)}
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
																groups={model.moveGroups[item.kind]}
																index={index}
																key={item.spaceId}
																layout={
																	section.id === "pinned"
																		? pinnedLayout
																		: "list"
																}
																memberAppearances={memberAppearances}
																messageUnreadCount={
																	indicators.messageUnreadCount
																}
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
																		? () =>
																				dm.save({
																					...dm.preferences,
																					archivedIds: archived
																						? dm.preferences.archivedIds.filter(
																								(id) => id !== item.spaceId
																							)
																						: [
																								...dm.preferences.archivedIds,
																								item.spaceId,
																							],
																				})
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
				</ContextMenuTrigger>
				<FluidDropdownMenuContent className="w-52">
					{creationMenu}
				</FluidDropdownMenuContent>
			</ContextMenu>
			{creating && (
				<NewChatDialog
					groupId={creatingGroup?.slice(5)}
					initialQuery={newMessageQuery}
					onCreated={
						creatingGroup
							? (id) => {
									if (!dm.store.preferences) {
										return;
									}
									return dm.store.saveAsync({
										...dm.store.preferences,
										messages: undefined,
										chats: {
											...dm.preferences,
											groups: dm.preferences.groups.map((group) => ({
												...group,
												spaceIds:
													group.id === creatingGroup.slice(5)
														? [
																...group.spaceIds.filter(
																	(value) => value !== id
																),
																id,
															]
														: group.spaceIds.filter((value) => value !== id),
											})),
										},
									});
								}
							: undefined
					}
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

function SpacesDirectoryLink({
	onNavigate,
	orgSlug,
}: {
	onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
	orgSlug: string;
}) {
	return (
		<Link
			aria-label="Spaces"
			className="flex min-w-20 flex-1 items-center rounded-sm font-medium text-sm focus-visible:outline-2"
			onClick={onNavigate}
			to={buildOrganizationSpacesPath(orgSlug)}
		>
			<span className="truncate">Spaces</span>
		</Link>
	);
}

function useHeaderActionOverflow() {
	const headerRef = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLDivElement>(null);
	const actionsRef = useRef<HTMLDivElement>(null);
	const [compactActions, setCompactActions] = useState(false);
	useLayoutEffect(() => {
		const header = headerRef.current;
		const title = titleRef.current;
		const actions = actionsRef.current;
		if (!(header && title && actions)) {
			return;
		}
		const measure = () => {
			const gap = Number.parseFloat(getComputedStyle(header).columnGap) || 0;
			setCompactActions(
				title.getBoundingClientRect().width +
					actions.getBoundingClientRect().width +
					gap >
					header.getBoundingClientRect().width
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(header);
		observer.observe(title);
		observer.observe(actions);
		return () => observer.disconnect();
	}, []);
	return { headerRef, titleRef, actionsRef, compactActions };
}
