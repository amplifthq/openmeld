import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import {
	ArchiveIcon,
	ChatCircleTextIcon,
	ClockIcon,
	CompassIcon,
	DotsThreeIcon,
	FolderIcon,
	FunnelSimpleIcon,
	ListIcon,
	PlusIcon,
	RobotIcon,
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
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { resolveInboxAttentionTone } from "#/lib/inbox/attention";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationNewSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { AppContextualSidebarNav } from "../app/app-contextual-layout";
import { ControlledSidebarGroupStateProvider } from "../app/app-sidebar-group";
import { SidebarDrag, SidebarDropSection } from "../app/sidebar-drag";
import { moveSidebarGroup } from "../app/sidebar-drop-target";
import { useSidebarFilter } from "../app/sidebar-filter";
import { SidebarListSkeleton } from "../app/sidebar-list-skeleton";
import { SidebarSearchInput } from "../app/sidebar-search-input";
import { SidebarSectionActions } from "../app/sidebar-section-actions";
import {
	type Conversation,
	type ConversationSection,
	conversationCategory,
} from "./conversation-sidebar-model";
import { ConversationSidebarRow } from "./conversation-sidebar-row";
import { NewChatDialog } from "./new-chat-dialog";
import { resolveSpaceMemberAppearances } from "./space-member-avatars";
import { useConversationDisclosure } from "./use-conversation-disclosure";
import { useConversationView } from "./use-conversation-view";
import { useConversations } from "./use-conversations";
import { useSpaceDirectoryFilters } from "./use-space-directory-filters";
import { useUnreadHistoryPrefetch } from "./use-unread-history-prefetch";

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

export function ConversationsSidebar(
	input: { currentProfileId?: string; currentSpaceId?: string } = {}
) {
	const model = useConversations(input);
	const { dismiss } = useAppNavigationPresentation();
	const onNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
		if (!(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) {
			dismiss();
		}
	};
	const { directMessages: dm } = model;
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
	const [search, setSearch] = useState("");
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
	const active = model.conversations.find(
		(item) => item.spaceId === model.selected
	);
	const activeSection = active ? model.owner(active) : null;
	const disclosure = useConversationDisclosure(
		dm.profileId,
		dm.org.id,
		model.selected,
		activeSection,
		!!search.trim() || filter.active
	);
	const filtered = model.conversations.filter(
		(item) =>
			kinds.includes(conversationCategory(item)) &&
			(item.kind === "direct-message"
				? dm.preferences.archivedIds.includes(item.spaceId) === archived
				: !archived) &&
			item.title
				.toLocaleLowerCase()
				.includes(search.trim().toLocaleLowerCase()) &&
			filter.includes(model.owner(item)) &&
			filter.matchesStatus(
				dm.indicators.unreadBySpaceId.get(item.spaceId)?.unreadCount ?? 0,
				dm.indicators.activeWakeSummaryBySpaceId.get(item.spaceId)
			)
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
	const pending =
		dm.store.isPending ||
		dm.spaces.isPending ||
		dm.sessions.isPending ||
		dm.directory.isPending ||
		waitingForActivity;
	const failed =
		dm.store.isError ||
		dm.spaces.isError ||
		dm.sessions.isError ||
		dm.directory.isError;
	const showSpaceEmptyState = isSpaceEmptyStateVisible(
		view,
		pending || failed || hasFilters,
		model.conversations
	);
	const move = (sectionId: string, id: string, beforeId?: string) => {
		const target = model.sections.find((section) => section.id === sectionId);
		if (!target) {
			return Promise.resolve();
		}
		return model.move(
			sectionId,
			id,
			rows(target).map((item) => item.spaceId),
			beforeId
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
			<DropdownMenuItem onClick={() => newMessage()}>
				<ChatCircleTextIcon />
				New message
			</DropdownMenuItem>
			<DropdownMenuItem
				render={
					<Link
						onClick={onNavigate}
						to={buildOrganizationNewSpacePath(dm.org.slug)}
					/>
				}
			>
				<PlusIcon /> New Space
			</DropdownMenuItem>
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
				<DropdownMenuRadioItem closeOnClick value="grouped">
					<FolderIcon /> Grouped
				</DropdownMenuRadioItem>
				<DropdownMenuRadioItem closeOnClick value="recent">
					<ClockIcon /> Recent
				</DropdownMenuRadioItem>
			</DropdownMenuRadioGroup>
		</>
	);
	const filterMenu = (
		<>
			{kinds.menu}
			<DropdownMenuSeparator />
			{filter.menu}
			<DropdownMenuSeparator />
			<DropdownMenuCheckboxItem
				checked={archived}
				onCheckedChange={setArchived}
			>
				<ArchiveIcon /> Archived direct messages
			</DropdownMenuCheckboxItem>
		</>
	);
	return (
		<>
			<div className="mb-2 px-1">
				<div
					className="relative flex min-w-0 items-center gap-1"
					ref={headerRef}
				>
					<div className="shrink-0" ref={titleRef}>
						<SpacesDirectoryLink
							onNavigate={onNavigate}
							orgSlug={dm.org.slug}
						/>
					</div>
					<div
						className={
							compactActions
								? "pointer-events-none invisible absolute right-0 flex w-max items-center gap-1"
								: "ml-auto flex shrink-0 items-center gap-1"
						}
						inert={compactActions}
						ref={actionsRef}
					>
						<Tooltip>
							<TooltipTrigger
								render={
									<Link
										aria-label="Browse spaces"
										className={buttonVariants({
											size: "icon-sm",
											variant: "ghost",
										})}
										onClick={onNavigate}
										to={buildOrganizationSpacesPath(dm.org.slug)}
									/>
								}
							>
								<CompassIcon aria-hidden="true" />
							</TooltipTrigger>
							<TooltipContent>Browse spaces</TooltipContent>
						</Tooltip>
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
										aria-label="Conversation view"
										size="icon-sm"
										variant="ghost"
									/>
								}
							>
								<ListIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">{viewMenu}</DropdownMenuContent>
						</DropdownMenu>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										aria-label="Filter conversations"
										size="icon-sm"
										variant="ghost"
									/>
								}
							>
								<FunnelSimpleIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								className="w-60 max-w-[calc(100vw-2rem)]"
							>
								{filterMenu}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									aria-label="Spaces actions"
									className="ml-auto hidden shrink-0 data-[compact=true]:inline-flex"
									data-compact={compactActions}
									size="icon-sm"
									variant="ghost"
								/>
							}
						>
							<DotsThreeIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-56">
							<DropdownMenuItem
								render={
									<Link
										onClick={onNavigate}
										to={buildOrganizationSpacesPath(dm.org.slug)}
									/>
								}
							>
								<CompassIcon aria-hidden="true" />
								Browse spaces
							</DropdownMenuItem>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger>
									<PlusIcon aria-hidden="true" />
									New conversation
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="w-60">
									{creationMenu}
								</DropdownMenuSubContent>
							</DropdownMenuSub>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger>
									<ListIcon aria-hidden="true" />
									Conversation view
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="w-60">
									{viewMenu}
								</DropdownMenuSubContent>
							</DropdownMenuSub>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger>
									<FunnelSimpleIcon aria-hidden="true" />
									Filter conversations
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="w-60">
									{filterMenu}
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			<div className="mb-2 px-1">
				<SidebarSearchInput
					label="Search conversations"
					onValueChange={setSearch}
					value={search}
				/>
			</div>
			{filter.badges}
			{kinds.badges}
			{archived && (
				<Button onClick={() => setArchived(false)} size="sm" variant="ghost">
					Archived direct messages · Clear
				</Button>
			)}
			{failed && (
				<Button
					onClick={() => {
						dm.spaces.refetch();
						dm.sessions.refetch();
						dm.directory.refetch();
						dm.store.retry();
					}}
					variant="ghost"
				>
					Could not load conversations. Retry
				</Button>
			)}
			{pending && (
				<SidebarListSkeleton
					label="Loading conversations"
					rowCount={2}
					showPreview
				/>
			)}
			{[pending, failed, showSpaceEmptyState, filtered.length > 0].every(
				(value) => !value
			) && (
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
			{dm.sessions.hasNextPage && (
				<p aria-live="polite" className="px-2 text-muted-foreground text-xs">
					Loading older direct messages…
				</p>
			)}
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
						groups={visible.map((section) => ({
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
											onSort={(sort) => model.updateSection(section, { sort })}
											sort={section.sort}
										/>
									)}
								</>
							),
							content: (
								<SidebarDropSection
									ids={rows(section).map((item) => item.spaceId)}
									section={section.id}
								>
									<SpaceSidebarEmptyState
										onNavigate={onNavigate}
										orgSlug={dm.org.slug}
										sectionId={section.id}
										visible={showSpaceEmptyState}
									/>
									<FluidNavMenu
										activeLayoutId="conversation-selection"
										activeValue={model.selected}
										aria-label={section.name}
									>
										{rows(section).map((item, index) => (
											<ConversationSidebarRow
												activeWakeSummary={dm.indicators.activeWakeSummaryBySpaceId.get(
													item.spaceId
												)}
												archived={archived}
												attentionTone={resolveInboxAttentionTone(
													dm.attentionById.get(item.spaceId) ?? {}
												)}
												conversation={item}
												disabled={model.disabled}
												dragDisabled={
													view === "recent" && section.id !== "pinned"
												}
												groups={model.sections.filter(
													(target) =>
														target.kind === "pinned" ||
														target.kind === item.kind
												)}
												index={index}
												key={item.spaceId}
												memberAppearances={memberAppearances}
												onArchive={
													item.kind === "direct-message"
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
													move(target, item.spaceId).catch(console.error)
												}
												onRename={
													item.kind === "direct-message"
														? () => {
																setRenaming(item);
																setName(item.title);
															}
														: undefined
												}
												onUnpin={() => model.unpin(item).catch(console.error)}
												profileId={item.profileId}
												section={section.id}
												selected={model.selected === item.spaceId}
												title={item.title}
												unreadCount={
													dm.indicators.unreadBySpaceId.get(item.spaceId)
														?.unreadCount ?? 0
												}
												url={item.url}
											/>
										))}
									</FluidNavMenu>
								</SidebarDropSection>
							),
						}))}
						placement="main"
						title="Conversations"
					/>
				</ControlledSidebarGroupStateProvider>
			</SidebarDrag>
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
			className="flex min-w-20 flex-1 items-center gap-2 rounded-sm font-medium text-sm focus-visible:outline-2"
			onClick={onNavigate}
			to={buildOrganizationSpacesPath(orgSlug)}
		>
			<ChatCircleTextIcon
				aria-hidden="true"
				className="size-4 shrink-0 text-muted-foreground"
			/>
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
