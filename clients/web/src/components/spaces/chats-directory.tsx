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
import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
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
	resolveInboxAttentionLabel,
	resolveInboxAttentionTone,
	resolveInboxIndicatorClassName,
} from "#/lib/inbox/attention";
import { buildOrganizationSpacesPath } from "#/lib/organizations/organization-routes";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { ChatIcon, resolvePreviewText } from "./conversation-sidebar-row";
import { NewChatDialog } from "./new-chat-dialog";
import { SidebarConversationTime } from "./sidebar-conversation-time";
import { SpaceWindowHeader } from "./space-header";
import { useChatFilters } from "./use-chat-filters";
import { useChats } from "./use-chats";

export function ChatsDirectory() {
	const [creating, setCreating] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [tab, setTab] = useState(0);
	const [search, setSearch] = useState("");
	const filter = useChatFilters(() => setSearchOpen(true));
	const model = useChats({
		currentSpaceId: "",
		search,
		archived: filter.archived,
		includes: filter.includes,
	});
	const now = useNowMs(60_000);
	const previewById = new Map(
		model.chats.map((chat, index) => [chat.spaceId, model.previews[index]])
	);
	const pending =
		model.spaces.isPending ||
		model.sessions.isPending ||
		model.directory.isPending ||
		model.store.isPending;
	const failed =
		model.spaces.isError ||
		model.sessions.isError ||
		model.directory.isError ||
		model.store.isError;
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
					actions={
						<div className="flex flex-wrap items-center gap-2">
							<Button
								render={
									<Link to={buildOrganizationSpacesPath(model.org.slug)} />
								}
								size="sm"
								variant="ghost"
							>
								Browse spaces
							</Button>
							{newChat}
						</div>
					}
					leadingControl={
						<ChatCircleTextIcon className="size-4 text-muted-foreground" />
					}
					navigation={
						<TabsSubtle
							aria-label="Direct messages view"
							className="h-full shrink-0 gap-5"
							idPrefix="chats-directory"
							onSelect={setTab}
							selectedIndex={tab}
							variant="underline"
						>
							<TabsSubtleItem
								index={0}
								label="Your direct messages"
								labelClassName="text-sm"
							/>
						</TabsSubtle>
					}
					renderFrame={false}
					title="Messenger"
				/>
			}
			scroll
		>
			<div
				aria-labelledby="chats-directory-tab-0"
				id="chats-directory-panel-0"
				role="tabpanel"
			>
				<div className="flex h-16 shrink-0 items-center justify-end gap-3">
					<div className="flex h-11 min-w-0 items-center justify-end gap-1">
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
							model.spaces.refetch();
							model.sessions.refetch();
							model.directory.refetch();
							model.store.retry();
						}}
						variant="outline"
					>
						Could not load direct messages. Retry
					</Button>
				)}
				{pending && sections.length === 0 && (
					<SidebarListSkeleton
						label="Loading direct messages"
						rowCount={4}
						showPreview
					/>
				)}
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
											No chats in this group yet.
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
															{preview
																? resolvePreviewText(preview)
																: "Loading message…"}
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
												<DirectoryRowActions
													disabled={
														model.store.disabled ||
														model.pin.arePinActionsPending
													}
													groupId={
														model.preferences.groups.find((group) =>
															group.spaceIds.includes(chat.spaceId)
														)?.id ?? "chats"
													}
													groups={[
														{ id: "chats", name: "Direct messages" },
														...model.preferences.groups,
													]}
													name={model.title(chat)}
													onMove={(groupId) =>
														model.move(groupId, chat.spaceId)
													}
													onTogglePinned={() =>
														section.id === "pinned"
															? model.unpin(chat.spaceId)
															: model.move("pinned", chat.spaceId)
													}
													pinned={section.id === "pinned"}
												/>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</AppSidebarGroup>
				))}
			</div>
			<NewChatDialog onOpenChange={setCreating} open={creating} />
		</AppMainContent>
	);
}
