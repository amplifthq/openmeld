import { createCenterAgentApi } from "@openmeld/api-client";
import type {
	AccountSidebarPreferences,
	ListCenterAgentSessionsResponse,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import {
	SidebarMenuActions,
	SidebarMenuButton,
} from "@openmeld/ui/fluid/sidebar-menu";
import { CloudIcon, DotsThreeIcon, PushPinIcon } from "@phosphor-icons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppContextualSidebarNav } from "#/components/app/app-contextual-layout";
import {
	SidebarDrag,
	SidebarDropSection,
	useSortableSidebarItem,
} from "#/components/app/sidebar-drag";
import { moveSidebarGroup } from "#/components/app/sidebar-drop-target";
import { SidebarFilterBadge } from "#/components/app/sidebar-filter-badge";
import { SidebarListSkeleton } from "#/components/app/sidebar-list-skeleton";
import {
	moveSidebarItemIds,
	sortSidebarManual,
} from "#/components/app/sidebar-order";
import { SidebarRowAction } from "#/components/app/sidebar-row-action";
import { SidebarSectionActions } from "#/components/app/sidebar-section-actions";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { useSpaceMessagePreview } from "#/components/spaces/direct-message-preview";
import {
	resolveConversationTimestamp,
	SidebarConversationTime,
} from "#/components/spaces/sidebar-conversation-time";
import { SpaceActiveWakeIndicator } from "#/components/spaces/space-active-wake-indicator";
import {
	resolveSpaceActiveWakePresentation,
	type SpaceSidebarActiveWakeSummary,
} from "#/components/spaces/space-active-wake-presentation";
import { useSpaceListIndicators } from "#/components/spaces/use-space-list-indicators";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { CenterAgentChatAvatar } from "./center-agent-chat-avatar";

type Preferences = NonNullable<AccountSidebarPreferences["chats"]>;
type Chat = { spaceId: string; name: string | null; createdAt: string | null };

export function CenterAgentChatSidebar({
	search = "",
	onFirstChatChange,
	embedded = false,
	showArchived,
	pinFilter,
}: {
	pinFilter?: "pinned" | "unpinned";
	search?: string;
	embedded?: boolean;
	showArchived?: boolean;
	onFirstChatChange?: (path: string | null | undefined) => void;
} = {}) {
	const { currentOrganization: org } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId ?? "";
	const store = useSidebarPreferences(profileId, org.id);
	const preferences = store.preferences?.chats ?? EMPTY_CHAT_PREFERENCES;
	const [renaming, setRenaming] = useState<Chat | null>(null);
	const [name, setName] = useState("");
	const [internalArchived, setArchived] = useState(false);
	const archived = showArchived ?? internalArchived;
	const navigate = useNavigate();
	const selected = useRouterState({
		select: (state) =>
			new URLSearchParams(state.location.searchStr).get("session"),
	});
	const sessions = useInfiniteQuery({
		queryKey: ["center-agent", org.id, profileId, "sessions", "sidebar"],
		enabled: !!profileId,
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (page: ListCenterAgentSessionsResponse) =>
			page.nextCursor ?? undefined,
		queryFn: ({ signal, pageParam }) => {
			const api = createCenterAgentApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: org.id,
				})
			);
			return api.listSessions({ limit: 100, cursor: pageParam, signal });
		},
		staleTime: 30_000,
	});
	const indicators = useSpaceListIndicators({
		currentProfileId: profileId,
		currentSpaceId: selected ?? "",
		organizationId: org.id,
		spaceIds:
			sessions.data?.pages.flatMap((page) =>
				page.sessions.map((chat) => chat.spaceId)
			) ?? [],
	});
	// Publish each page immediately; searching and saved groups include older chats
	// as subsequent pages arrive, without holding the first page behind them.
	useEffect(() => {
		if (sessions.hasNextPage && !sessions.isFetching && !sessions.isError) {
			sessions.fetchNextPage();
		}
	}, [
		sessions.hasNextPage,
		sessions.isFetching,
		sessions.isError,
		sessions.fetchNextPage,
	]);
	const save = (chats: Preferences) => {
		if (store.preferences) {
			store.save({ ...store.preferences, chats });
		}
	};
	const sections = [
		{ id: "pinned", name: "Pinned", ...preferences.pinned },
		...preferences.groups,
		{ id: "chats", name: "Agents", ...preferences.spaces },
	];
	const title = (chat: Chat) =>
		preferences.titles[chat.spaceId] ?? chat.name ?? "New chat";
	const owner = (id: string) =>
		preferences.pinned.spaceIds.includes(id)
			? "pinned"
			: (preferences.groups.find((g) => g.spaceIds.includes(id))?.id ??
				"chats");
	const rows = (section: string) => {
		const config = sections.find((s) => s.id === section);
		if (!config) {
			return [];
		}
		const items = (
			sessions.data?.pages.flatMap((page) => page.sessions) ?? []
		).filter(
			(chat) =>
				owner(chat.spaceId) === section &&
				preferences.archivedIds.includes(chat.spaceId) === archived &&
				title(chat).toLocaleLowerCase().includes(search.toLocaleLowerCase())
		);
		return config.sort === "manual"
			? sortSidebarManual(items, config.spaceIds, (c) => c.spaceId)
			: items.sort((a, b) =>
					config.sort === "name"
						? title(a).localeCompare(title(b))
						: (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
				);
	};
	const move = (section: string, id: string, before?: string) => {
		const target = sections.find((s) => s.id === section);
		if (!target || store.disabled) {
			return;
		}
		const ids = moveSidebarItemIds(
			target.spaceIds,
			rows(section).map((c) => c.spaceId),
			id,
			before
		);
		if (section === "pinned") {
			save({ ...preferences, pinned: { sort: "manual", spaceIds: ids } });
			return;
		}
		save({
			...preferences,
			pinned:
				section === "pinned"
					? { sort: "manual", spaceIds: ids }
					: {
							...preferences.pinned,
							spaceIds: preferences.pinned.spaceIds.filter((v) => v !== id),
						},
			spaces:
				section === "chats"
					? { sort: "manual", spaceIds: ids }
					: {
							...preferences.spaces,
							spaceIds: preferences.spaces.spaceIds.filter((v) => v !== id),
						},
			groups: preferences.groups.map((g) =>
				g.id === section
					? { ...g, sort: "manual", spaceIds: ids }
					: { ...g, spaceIds: g.spaceIds.filter((v) => v !== id) }
			),
		});
	};
	const newChat = (group?: string) =>
		navigate({
			to: buildOrganizationCenterAgentChatPath(org.slug, {
				draft: "new",
				group,
			}),
		});
	const sortSection = (id: string, sort: Preferences["spaces"]["sort"]) => {
		if (id === "pinned") {
			save({ ...preferences, pinned: { ...preferences.pinned, sort } });
		} else if (id === "chats") {
			save({ ...preferences, spaces: { ...preferences.spaces, sort } });
		} else {
			save({
				...preferences,
				groups: preferences.groups.map((g) =>
					g.id === id ? { ...g, sort } : g
				),
			});
		}
	};
	const visibleSections = sections.filter(
		(section) =>
			(!pinFilter || (section.id === "pinned") === (pinFilter === "pinned")) &&
			((section.id !== "pinned" && section.id !== "chats") ||
				rows(section.id).length > 0)
	);
	const firstChat = visibleSections.flatMap((section) => rows(section.id))[0];
	const firstChatPath = firstChat
		? buildOrganizationCenterAgentChatPath(org.slug, {
				session: firstChat.spaceId,
			})
		: null;
	const firstChatReady = !(
		sessions.isPending ||
		sessions.hasNextPage ||
		sessions.isError ||
		store.isPending ||
		store.isError
	);
	useEffect(() => {
		onFirstChatChange?.(firstChatReady ? firstChatPath : undefined);
	}, [onFirstChatChange, firstChatReady, firstChatPath]);
	const addGroup = (name: string) =>
		save({
			...preferences,
			groups: [
				...preferences.groups,
				{ id: crypto.randomUUID(), name, sort: "recent", spaceIds: [] },
			],
		});
	return (
		<>
			<SidebarDrag
				canDrop={() => !store.disabled}
				groupIds={preferences.groups.map((g) => g.id)}
				onMove={move}
				onMoveGroup={(id, before) =>
					save({
						...preferences,
						groups: moveSidebarGroup(preferences.groups, id, before),
					})
				}
			>
				<AppContextualSidebarNav
					activeItemId={selected}
					ariaLabel="Center Agent chats"
					groups={visibleSections.map((section) => ({
						id: section.id,
						contentOnly:
							embedded && (section.id === "chats" || section.id === "pinned"),
						label: section.name,
						ariaLabel: section.name,
						onRename:
							section.id !== "pinned" && section.id !== "chats"
								? (name: string) =>
										save({
											...preferences,
											groups: preferences.groups.map((g) =>
												g.id === section.id ? { ...g, name } : g
											),
										})
								: undefined,
						labelAccessory: (
							<SidebarSectionActions
								addLabel="Add chat or group"
								disabled={store.disabled}
								filter={{
									label: "Archived chats",
									checked: archived,
									onCheckedChange: setArchived,
								}}
								label={section.name}
								newItemLabel="New chat"
								onDelete={
									section.id !== "pinned" && section.id !== "chats"
										? () =>
												save({
													...preferences,
													groups: preferences.groups.filter(
														(g) => g.id !== section.id
													),
												})
										: undefined
								}
								onNewGroup={(name) =>
									save({
										...preferences,
										groups: [
											...preferences.groups,
											{
												id: crypto.randomUUID(),
												name,
												sort: "recent",
												spaceIds: [],
											},
										],
									})
								}
								onNewItem={() =>
									newChat(
										section.id === "chats" || section.id === "pinned"
											? undefined
											: section.id
									)
								}
								onSort={(sort) => sortSection(section.id, sort)}
								sort={section.sort}
								sortOptions={[
									["recent", "Newest first"],
									["name", "Name"],
									["manual", "Manual order"],
								]}
							/>
						),
						content: (
							<SidebarDropSection
								ids={rows(section.id).map((c) => c.spaceId)}
								section={section.id}
							>
								{rows(section.id).length === 0 && (
									<p className="p-2 text-muted-foreground text-xs">
										{search.trim()
											? "No chats match your search."
											: "No chats yet."}
									</p>
								)}
								<FluidNavMenu
									activeLayoutId="center-agent-chat-selection"
									activeValue={selected}
									aria-label={section.name}
								>
									{rows(section.id).map((chat, index) => (
										<ChatRow
											activeWakeSummary={indicators.activeWakeSummaryBySpaceId.get(
												chat.spaceId
											)}
											archived={archived}
											chat={chat}
											disabled={store.disabled}
											groups={sections}
											index={index}
											key={chat.spaceId}
											onArchive={() =>
												save({
													...preferences,
													archivedIds: archived
														? preferences.archivedIds.filter(
																(id) => id !== chat.spaceId
															)
														: [...preferences.archivedIds, chat.spaceId],
												})
											}
											onMove={(s) => move(s, chat.spaceId)}
											onRename={() => {
												setName(title(chat));
												setRenaming(chat);
											}}
											onUnpin={() =>
												save({
													...preferences,
													pinned: {
														...preferences.pinned,
														spaceIds: preferences.pinned.spaceIds.filter(
															(id) => id !== chat.spaceId
														),
													},
												})
											}
											profileId={profileId}
											section={section.id}
											selected={selected === chat.spaceId}
											title={title(chat)}
											unreadCount={
												indicators.unreadBySpaceId.get(chat.spaceId)
													?.unreadCount ?? 0
											}
											url={buildOrganizationCenterAgentChatPath(org.slug, {
												session: chat.spaceId,
											})}
										/>
									))}
								</FluidNavMenu>
							</SidebarDropSection>
						),
					}))}
					leadingContent={
						<>
							{!embedded && visibleSections.length === 0 && (
								<div className="group/sidebar-group-root flex items-center justify-between px-1">
									<Button onClick={() => newChat()} variant="ghost">
										New chat
									</Button>
									<SidebarSectionActions
										addLabel="Add chat or group"
										disabled={store.disabled}
										filter={{
											label: "Archived chats",
											checked: archived,
											onCheckedChange: setArchived,
										}}
										label="Chats"
										newItemLabel="New chat"
										onNewGroup={addGroup}
										onNewItem={() => newChat()}
										onSort={(sort) => sortSection("chats", sort)}
										sort="recent"
									/>
								</div>
							)}
							{archived && (
								<div className="px-1 pt-1">
									<SidebarFilterBadge
										label="Archived"
										onRemove={() => setArchived(false)}
									/>
								</div>
							)}
							{sessions.hasNextPage && (
								<p
									aria-live="polite"
									className="px-2 text-muted-foreground text-sm"
								>
									Loading older chats…
								</p>
							)}
							{store.isError && (
								<Button onClick={() => store.retry()} variant="ghost">
									Could not load sidebar settings. Retry
								</Button>
							)}
							{sessions.isPending && (
								<SidebarListSkeleton
									label="Loading Center Agent chats"
									rowCount={2}
									showPreview
								/>
							)}
							{sessions.isError && (
								<Button onClick={() => sessions.refetch()} variant="ghost">
									Could not load chats. Retry
								</Button>
							)}
						</>
					}
					placement="main"
					title="Chats"
				/>
			</SidebarDrag>
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
						<DialogTitle>Rename chat</DialogTitle>
					</DialogHeader>
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (!(renaming && name.trim()) || store.disabled) {
								return;
							}
							save({
								...preferences,
								titles: {
									...preferences.titles,
									[renaming.spaceId]: name.trim(),
								},
							});
							setRenaming(null);
						}}
					>
						<Input
							aria-label="Chat name"
							autoFocus
							maxLength={160}
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
						<Button disabled={store.disabled || !name.trim()} type="submit">
							Save
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}

function ChatRow(input: {
	index: number;
	profileId: string;
	unreadCount: number;
	activeWakeSummary?: SpaceSidebarActiveWakeSummary;
	chat: Chat;
	title: string;
	section: string;
	selected: boolean;
	disabled: boolean;
	url: string;
	groups: { id: string; name: string }[];
	onMove: (id: string) => void;
	archived: boolean;
	onArchive: () => void;
	onRename: () => void;
	onUnpin: () => void;
}) {
	const preview = useSpaceMessagePreview({
		spaceId: input.chat.spaceId,
		viewerProfileId: input.profileId,
		enabled: !!input.profileId,
	});
	const nowMs = useNowMs(preview.data ? 60_000 : null);
	const timestamp = resolveConversationTimestamp(
		preview.data?.timestamp,
		input.chat.createdAt
	);
	const presentation = input.activeWakeSummary
		? resolveSpaceActiveWakePresentation(input.activeWakeSummary)
		: null;
	const hasUnread = input.unreadCount > 0;
	let previewText = "No messages yet";
	if (preview.isPending) {
		previewText = "Loading message…";
	}
	if (preview.isError) {
		previewText = "Couldn’t load preview. Open chat to retry.";
	}
	if (preview.data) {
		previewText = preview.data.text;
	}
	const needsInput = input.activeWakeSummary?.statuses?.some(
		(status) => status.kind === "needs_input"
	);
	const drag = useSortableSidebarItem({
		section: input.section,
		itemId: input.chat.spaceId,
		name: input.title,
		disabled: input.disabled,
	});
	return (
		<FluidNavMenuItem
			className="group/chat relative"
			index={input.index}
			ref={drag.ref}
			style={drag.style}
			value={input.chat.spaceId}
		>
			<SidebarMenuButton
				actionLayout="heading"
				asChild
				className="h-auto"
				isActive={input.selected}
			>
				<Link
					{...drag.rowProps}
					aria-current={input.selected ? "page" : undefined}
					aria-label={[
						input.title,
						hasUnread ? "unread messages" : null,
						presentation?.label,
					]
						.filter(Boolean)
						.join(", ")}
					className={`flex min-h-12 w-full min-w-0 items-center gap-2 px-2 py-1.5 text-sm outline-none ${input.selected ? "font-medium text-sidebar-accent-foreground" : "text-muted-foreground"}`}
					to={input.url}
				>
					<CenterAgentChatAvatar
						working={
							input.activeWakeSummary?.statuses?.some(
								(status) => status.kind === "working"
							) ?? false
						}
					/>
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span
							className="flex min-w-0 items-center gap-2"
							data-sidebar="menu-heading"
						>
							<span className="flex min-w-0 flex-1 items-center gap-1.5">
								<span
									className={`truncate ${hasUnread ? "font-semibold text-sidebar-foreground" : ""}`}
								>
									{input.title}
								</span>
								{presentation && (
									<span
										className="inline-flex shrink-0"
										title={presentation.label}
									>
										<SpaceActiveWakeIndicator presentation={presentation} />
									</span>
								)}
							</span>
							<Tooltip>
								<TooltipTrigger
									render={
										<span
											aria-label="Center Agent chat"
											className="inline-flex shrink-0 text-muted-foreground"
											role="img"
										/>
									}
								>
									<CloudIcon aria-hidden="true" className="size-3" />
								</TooltipTrigger>
								<TooltipContent>Center Agent chat</TooltipContent>
							</Tooltip>
							{timestamp !== null && (
								<SidebarConversationTime
									now={new Date(nowMs)}
									timestamp={timestamp}
								/>
							)}
							{hasUnread && (
								<span
									aria-hidden="true"
									className="status-dot shrink-0 bg-unread"
									data-chat-unread-indicator="true"
								/>
							)}
						</span>
						<span className="truncate font-normal text-muted-foreground text-xs leading-4">
							{needsInput && presentation ? presentation.label : previewText}
						</span>
					</span>
				</Link>
			</SidebarMenuButton>
			<SidebarMenuActions showOnHover>
				<SidebarRowAction
					disabled={input.disabled}
					label={`${input.section === "pinned" ? "Unpin" : "Pin"} ${input.title}`}
					onClick={() =>
						input.section === "pinned"
							? input.onUnpin()
							: input.onMove("pinned")
					}
				>
					<PushPinIcon
						weight={input.section === "pinned" ? "fill" : "regular"}
					/>
				</SidebarRowAction>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								aria-label={`Actions for ${input.title}`}
								className="size-6"
								size="icon-sm"
								variant="ghost"
							/>
						}
					>
						<DotsThreeIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							disabled={input.disabled}
							onClick={input.onRename}
						>
							Rename
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={input.disabled}
							onClick={() =>
								input.section === "pinned"
									? input.onUnpin()
									: input.onMove("pinned")
							}
						>
							{input.section === "pinned" ? "Unpin" : "Pin"}
						</DropdownMenuItem>
						{input.groups
							.filter((g) => g.id !== input.section && g.id !== "pinned")
							.map((g) => (
								<DropdownMenuItem
									disabled={input.disabled}
									key={g.id}
									onClick={() => input.onMove(g.id)}
								>
									Move to {g.name}
								</DropdownMenuItem>
							))}
						<DropdownMenuItem
							disabled={input.disabled}
							onClick={input.onArchive}
						>
							{input.archived ? "Unarchive" : "Archive"}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuActions>
		</FluidNavMenuItem>
	);
}
