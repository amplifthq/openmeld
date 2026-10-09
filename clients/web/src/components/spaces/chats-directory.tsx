import { normalizeMessagePreview } from "@openmeld/protocol";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { FluidContextMenuScope } from "@openmeld/ui/fluid/context-menu";
import {
	ChatCircleTextIcon,
	FunnelSimpleIcon,
	PlusIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppEmptyState } from "#/components/app/app-empty-state";
import { AppMainContent } from "#/components/app/app-main-content";
import { AppSidebarGroup } from "#/components/app/app-sidebar-group";
import { DirectoryRowActions } from "#/components/app/directory-row-actions";
import { DirectorySearch } from "#/components/app/directory-search";
import { SidebarListSkeleton } from "#/components/app/sidebar-list-skeleton";
import { SidebarSectionActions } from "#/components/app/sidebar-section-actions";
import {
	DirectoryCardGrid,
	DirectoryCardItem,
} from "#/components/directory/directory-card-grid";
import {
	resolveInboxAttentionLabel,
	resolveInboxAttentionTone,
	resolveInboxIndicatorClassName,
} from "#/lib/inbox/attention";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { useDelayedPending } from "#/lib/use-delayed-pending";
import { ChatArchiveButton } from "./chat-archive-button";
import type { Chat } from "./chat-sidebar-model";
import { ChatIcon, resolvePreviewText } from "./conversation-sidebar-row";
import { NewChatDialog } from "./new-chat-dialog";
import { SidebarConversationTime } from "./sidebar-conversation-time";
import { SpaceWindowHeader } from "./space-header";
import { SpaceLayoutSwitch, useSpaceLayout } from "./space-layout-switch";
import { SpaceUnreadLink } from "./space-unread-link";
import { SpacesDirectoryNavigation } from "./spaces-directory-navigation";
import { useChatFilters } from "./use-chat-filters";
import { useChats } from "./use-chats";
import { useMessagePreviews } from "./use-message-previews";

function useChatsDirectoryReadState(model: ReturnType<typeof useChats>) {
	const waitingForProfile =
		model.needsDefaultHumanProfile && model.profilesQuery.isPending;
	const waitingForSpaces = model.spaces.isPending && !!model.profileId;
	const waitingForSessions = model.sessions.isPending && !!model.profileId;
	const pending =
		waitingForProfile ||
		waitingForSpaces ||
		waitingForSessions ||
		(model.store.isPending && !model.store.preferences);
	const paused =
		(waitingForProfile && model.profilesQuery.fetchStatus === "paused") ||
		(waitingForSpaces && model.spaces.fetchStatus === "paused") ||
		(waitingForSessions && model.sessions.fetchStatus === "paused");
	const showDelayedPending = useDelayedPending(pending && !paused);
	const failed =
		(model.needsDefaultHumanProfile &&
			!model.profileId &&
			(model.profilesQuery.isError || model.profilesQuery.isSuccess)) ||
		model.spaces.isError ||
		model.sessions.isError ||
		model.directory.isError ||
		model.store.isError;
	return { failed, paused, pending, showDelayedPending };
}

export function ChatsDirectory() {
	const [creating, setCreating] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [search, setSearch] = useState("");
	const filter = useChatFilters(() => setSearchOpen(true));
	const model = useChats({
		currentSpaceId: "",
		search,
		archived: filter.archived,
		includes: filter.includes,
	});
	const now = useNowMs(60_000);
	const { layout, setLayout } = useSpaceLayout(model.profileId, model.org.id);
	const { showMessagePreviews } = useMessagePreviews(
		model.profileId,
		model.org.id
	);
	const previewById = new Map(
		model.chats.map((chat, index) => [chat.spaceId, model.previews[index]])
	);
	const { failed, paused, pending, showDelayedPending } =
		useChatsDirectoryReadState(model);
	const grouped =
		model.preferences.groups.length > 0 ||
		model.preferences.pinned.spaceIds.length > 0;
	const sections = model.sections
		.map((section) => ({ ...section, chats: model.rows(section.id) }))
		.filter(
			(section) =>
				section.chats.length > 0 ||
				(grouped &&
					!filter.archived &&
					section.id !== "pinned" &&
					!search &&
					!filter.selected.length)
		);
	const addGroup = (name: string) =>
		model.save({
			...model.preferences,
			groups: [
				...model.preferences.groups,
				{ id: crypto.randomUUID(), name, sort: "priority", spaceIds: [] },
			],
		});
	const sectionActions = (
		section: (typeof model.sections)[number],
		alwaysVisible = false
	) => (
		<SidebarSectionActions
			alwaysVisible={alwaysVisible}
			disabled={model.store.disabled}
			filter={filter.sectionFilter}
			label={section.name}
			onDelete={
				section.id !== "chats" && section.id !== "pinned"
					? () =>
							model.save({
								...model.preferences,
								groups: model.preferences.groups.filter(
									(group) => group.id !== section.id
								),
							})
					: undefined
			}
			onNewGroup={addGroup}
			onSort={(sort) => model.sortSection(section.id, sort)}
			sort={section.sort}
		/>
	);
	const newChat = (
		<Button
			className="max-lg:min-h-8"
			onClick={() => setCreating(true)}
			size="sm"
		>
			<PlusIcon />
			New message
		</Button>
	);
	return (
		<AppMainContent
			bodyClassName="px-[var(--app-page-inline-padding)] pb-6"
			header={
				<SpaceWindowHeader
					actions={newChat}
					leadingControl={
						<ChatCircleTextIcon className="size-4 text-muted-foreground" />
					}
					navigation={<SpacesDirectoryNavigation />}
					renderFrame={false}
					title="Spaces"
				/>
			}
			scroll
		>
			<div
				aria-labelledby="spaces-directory-tab-1"
				id="spaces-directory-panel-1"
				role="tabpanel"
			>
				<div className="flex min-h-16 shrink-0 items-center justify-end gap-3 py-3">
					<div className="flex min-h-10 min-w-0 flex-wrap items-center justify-end gap-1">
						<SpaceLayoutSwitch layout={layout} setLayout={setLayout} />
						<DirectorySearch
							label="Search direct messages"
							onChange={setSearch}
							onOpenChange={setSearchOpen}
							open={searchOpen}
							value={search}
						/>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										aria-label="Filter direct messages"
										size="icon-sm"
										variant="ghost"
									/>
								}
							>
								<FunnelSimpleIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{filter.menu}
							</DropdownMenuContent>
						</DropdownMenu>
						{!grouped &&
							sectionActions(
								{
									id: "chats",
									name: "Direct messages",
									...model.preferences.spaces,
								},
								true
							)}
					</div>
				</div>
				{filter.badges}
				{failed && (
					<Button
						onClick={() => {
							model.profilesQuery.refetch();
							model.spaces.refetch();
							model.sessions.refetch();
							model.directory.refetch();
							model.store.retry();
						}}
						variant="outline"
					>
						{model.sessions.isFetchNextPageError
							? "Could not check older direct messages. Retry"
							: "Could not load direct messages. Retry"}
					</Button>
				)}
				{paused && !failed ? (
					<p className="py-2 text-muted-foreground text-sm">
						Connect to the internet to load direct messages.
					</p>
				) : null}
				{showDelayedPending && !paused && sections.length === 0 && (
					<SidebarListSkeleton
						label="Loading direct messages"
						rowCount={4}
						showPreview
					/>
				)}
				{model.sessions.isFetchingNextPage ? (
					<p aria-live="polite" className="py-2 text-muted-foreground text-sm">
						Loading older direct messages…
					</p>
				) : null}
				{!(pending || failed || model.sessions.hasNextPage) &&
					sections.length === 0 && (
						<AppEmptyState
							actions={filter.archived ? undefined : newChat}
							description={
								search || filter.selected.length || filter.archived
									? "Try another search or remove a filter."
									: "Choose a person or agent to chat with, or select several to start a Space."
							}
							icon={<ChatCircleTextIcon />}
							title={
								search || filter.selected.length || filter.archived
									? "No matching chats"
									: "Start a conversation"
							}
						/>
					)}
				{sections.map((section) => (
					<AppSidebarGroup
						contentOnly={!grouped}
						groupClassName="mb-8 p-0"
						groupId={`chats-directory-${section.id}`}
						key={section.id}
						label={section.name}
						labelAccessory={sectionActions(section)}
						labelClassName="px-2"
						labelText={section.name}
						onRename={
							section.id !== "chats" && section.id !== "pinned"
								? (name) =>
										model.save({
											...model.preferences,
											groups: model.preferences.groups.map((group) =>
												group.id === section.id ? { ...group, name } : group
											),
										})
								: undefined
						}
					>
						{layout === "cards" ? (
							<DirectoryCardGrid
								aria-label={section.name}
								className="grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] lg:grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))]"
							>
								{section.chats.map((chat) => (
									<ChatDirectoryCard
										chat={chat}
										key={chat.spaceId}
										model={model}
										sectionId={section.id}
										showMessagePreviews={showMessagePreviews}
									/>
								))}
								{section.chats.length === 0 && (
									<p className="text-muted-foreground text-xs">
										{pending || model.sessions.hasNextPage
											? "Checking older direct messages…"
											: "No chats in this group yet."}
									</p>
								)}
							</DirectoryCardGrid>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Chat</TableHead>
										<TableHead className="w-40">Status</TableHead>
										<TableHead className="w-28">Activity</TableHead>
										<TableHead className="w-20">
											<span className="sr-only">Actions</span>
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{section.chats.length === 0 && (
										<TableRow>
											<TableCell
												className="py-4 text-muted-foreground text-xs"
												colSpan={4}
											>
												{pending || model.sessions.hasNextPage
													? "Checking older direct messages…"
													: "No chats in this group yet."}
											</TableCell>
										</TableRow>
									)}
									{section.chats.map((chat) => {
										const unread =
											model.indicators.unreadBySpaceId.get(chat.spaceId)
												?.unreadCount ?? 0;
										const tone = resolveInboxAttentionTone(
											model.attentionById.get(chat.spaceId) ?? {}
										);
										const preview = previewById.get(chat.spaceId);
										const time = model.activity.get(chat.spaceId);
										return (
											<TableRow
												className="group/directory-row border-0"
												contextMenu
												key={chat.spaceId}
											>
												<TableCell className="max-w-0 py-4">
													<Link
														className="flex items-center gap-3"
														to={model.chatPath(chat)}
													>
														<ChatIcon
															chat={chat}
															summary={model.indicators.activeWakeSummaryBySpaceId.get(
																chat.spaceId
															)}
															title={model.title(chat)}
														/>
														<span className="min-w-0">
															<span
																className={`block truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}
															>
																{model.title(chat)}
															</span>
															<span className="mt-1 block truncate text-muted-foreground text-xs">
																{resolvePreviewText(preview)}
															</span>
														</span>
													</Link>
												</TableCell>
												<TableCell>
													{(unread > 0 || tone) && (
														<span className="inline-flex items-center gap-2 text-muted-foreground text-xs">
															<span
																className={`status-dot ${resolveInboxIndicatorClassName(tone)}`}
															/>
															{resolveInboxAttentionLabel(tone) ??
																`${unread} unread`}
														</span>
													)}
												</TableCell>
												<TableCell>
													{time ? (
														<SidebarConversationTime
															className="text-xs"
															now={new Date(now)}
															timestamp={time}
														/>
													) : null}
												</TableCell>
												<TableCell>
													<ChatDirectoryActions
														chat={chat}
														model={model}
														sectionId={section.id}
													/>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						)}
					</AppSidebarGroup>
				))}
			</div>
			<NewChatDialog onOpenChange={setCreating} open={creating} />
		</AppMainContent>
	);
}

function ChatDirectoryCard({
	showMessagePreviews,
	model,
	chat,
	sectionId,
}: {
	model: ReturnType<typeof useChats>;
	showMessagePreviews: boolean;
	chat: Chat;
	sectionId: string;
}) {
	const title = model.title(chat);
	const href = model.chatPath(chat);
	const unread =
		model.indicators.unreadBySpaceId.get(chat.spaceId)?.unreadCount ?? 0;
	const tone = resolveInboxAttentionTone(
		model.attentionById.get(chat.spaceId) ?? {}
	);
	const latest =
		model.previews[
			model.chats.findIndex((item) => item.spaceId === chat.spaceId)
		]?.data;
	const previews =
		chat.recentMessagePreviews ??
		(latest ? [{ ...latest, text: normalizeMessagePreview(latest.text) }] : []);
	return (
		<DirectoryCardItem className="border border-border" itemId={chat.spaceId}>
			<FluidContextMenuScope
				target={
					<div className="@container/space-card group/directory-row relative flex h-full min-w-0 flex-col gap-3 rounded-md p-4">
						<div className="absolute top-2 right-2 z-20">
							<ChatDirectoryActions
								chat={chat}
								model={model}
								sectionId={sectionId}
							/>
						</div>
						<div className="flex w-fit items-start">
							<ChatIcon
								chat={chat}
								size="card"
								summary={model.indicators.activeWakeSummaryBySpaceId.get(
									chat.spaceId
								)}
								title={title}
							/>
						</div>
						<div className="flex min-w-0 items-center gap-2">
							<Link
								aria-label={`Open ${title}`}
								className={`min-w-0 flex-1 truncate text-sm outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring ${unread ? "font-semibold" : "font-medium"}`}
								to={href}
							>
								{title}
							</Link>
							{unread > 0 && (
								<span className="relative z-10 flex shrink-0 items-center">
									<SpaceUnreadLink
										count={unread}
										messageUnreadCount={
											model.indicators.unreadBySpaceId.get(chat.spaceId)
												?.messageUnreadCount
										}
										spaceId={chat.spaceId}
										url={href}
										variant="badge"
									/>
								</span>
							)}
						</div>
						{tone && (
							<span className="relative z-10 inline-flex items-center gap-2 text-muted-foreground text-xs">
								<span
									className={`status-dot ${resolveInboxIndicatorClassName(tone)}`}
								/>
								{resolveInboxAttentionLabel(tone)}
							</span>
						)}
						{showMessagePreviews && previews.length > 0 && (
							<div className="relative z-10 flex min-w-0 flex-col gap-1">
								{previews.slice(0, 1).map((preview) => (
									<TooltipHint content={preview.text} key={preview.signalId}>
										<Link
											aria-label={`Preview message in ${title}: ${preview.text}`}
											className="block truncate rounded-sm text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
											to={model.chatPath(chat, preview.signalId)}
										>
											{preview.text}
										</Link>
									</TooltipHint>
								))}
							</div>
						)}
					</div>
				}
			/>
		</DirectoryCardItem>
	);
}

function ChatDirectoryActions({
	model,
	chat,
	sectionId,
}: {
	model: ReturnType<typeof useChats>;
	chat: Chat;
	sectionId: string;
}) {
	return (
		<div className="flex items-center">
			<span className="opacity-0 group-focus-within/directory-row:opacity-100 group-hover/directory-row:opacity-100 [@media(hover:none)]:opacity-100">
				<ChatArchiveButton spaceId={chat.spaceId} />
			</span>
			<DirectoryRowActions
				disabled={model.store.disabled || model.pin.arePinActionsPending}
				groupId={
					model.preferences.groups.find((group) =>
						group.spaceIds.includes(chat.spaceId)
					)?.id ?? "chats"
				}
				groups={[
					{ id: "chats", name: "Direct messages" },
					...model.preferences.groups,
				]}
				href={model.chatPath(chat)}
				name={model.title(chat)}
				onMove={(groupId) => model.move(groupId, chat.spaceId)}
				onTogglePinned={() =>
					sectionId === "pinned"
						? model.unpin(chat.spaceId)
						: model.move("pinned", chat.spaceId)
				}
				pinned={sectionId === "pinned"}
			/>
		</div>
	);
}
