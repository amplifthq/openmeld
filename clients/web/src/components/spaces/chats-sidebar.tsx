import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
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
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { FunnelSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AppContextualSidebarNav } from "#/components/app/app-contextual-layout";
import { SidebarDrag, SidebarDropSection } from "#/components/app/sidebar-drag";
import { moveSidebarGroup } from "#/components/app/sidebar-drop-target";
import { useSidebarFilter } from "#/components/app/sidebar-filter";
import { SidebarFilterBadge } from "#/components/app/sidebar-filter-badge";
import { SidebarListSkeleton } from "#/components/app/sidebar-list-skeleton";
import { moveSidebarItemIds } from "#/components/app/sidebar-order";
import { SidebarSectionActions } from "#/components/app/sidebar-section-actions";
import { resolveInboxAttentionTone } from "#/lib/inbox/attention";
import { SidebarDestinationAction } from "../app/sidebar-destination-actions";
import { SidebarSearchInput } from "../app/sidebar-search-input";
import type { Chat } from "./chat-sidebar-model";
import { ChatRow } from "./chat-sidebar-row";
import { NewDirectMessageDialog } from "./new-direct-message-dialog";
import { useAccountSpacePinMutation } from "./use-account-space-pin-mutation";
import { useChats } from "./use-chats";

type Preferences = NonNullable<AccountSidebarPreferences["chats"]>;

export function ChatsSidebar(input: { currentSpaceId?: string } = {}) {
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const categoryFilter = useSidebarFilter(
		[
			{ id: "human", label: "People" },
			{ id: "agent", label: "Agents" },
		],
		"All chats"
	);
	const [creating, setCreating] = useState(false);
	const [creatingGroup, setCreatingGroup] = useState<string>();
	const [archived, setArchived] = useState(false);
	const {
		profileId,
		store,
		spaces,
		directory,
		sessions,
		ordinaryAccountItems,
		preferences,
		chatPath,
		attentionById,
		indicators,
		selected,
		save,
		sections,
		title,
		rows,
	} = useChats({
		...input,
		search,
		archived,
		includes: categoryFilter.includes,
	});
	const pin = useAccountSpacePinMutation({ currentProfileId: profileId });
	const [renaming, setRenaming] = useState<Chat | null>(null);
	const [name, setName] = useState("");
	const move = async (section: string, id: string, before?: string) => {
		const target = sections.find((s) => s.id === section);
		if (!target || store.disabled) {
			return;
		}
		const accountItem = ordinaryAccountItems.find(
			(item) => item.spaceId === id
		);
		if (
			accountItem &&
			!(await pin.setPinned(accountItem, section === "pinned"))
		) {
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
			pinned: {
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
	const newChat = (group?: string) => {
		setCreatingGroup(group);
		setCreating(true);
	};
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
			(section.id !== "pinned" && section.id !== "chats") ||
			rows(section.id).length > 0
	);
	const addGroup = (name: string) =>
		save({
			...preferences,
			groups: [
				...preferences.groups,
				{ id: crypto.randomUUID(), name, sort: "priority", spaceIds: [] },
			],
		});
	const unpin = async (id: string) => {
		const accountItem = ordinaryAccountItems.find(
			(item) => item.spaceId === id
		);
		if (accountItem && !(await pin.setPinned(accountItem, false))) {
			return;
		}
		save({
			...preferences,
			pinned: {
				...preferences.pinned,
				spaceIds: preferences.pinned.spaceIds.filter((value) => value !== id),
			},
		});
	};
	return (
		<>
			<SidebarSearchInput
				destination="directMessages"
				label="Search chats"
				onOpenChange={setSearchOpen}
				onValueChange={setSearch}
				open={searchOpen}
				value={search}
			/>
			<SidebarDestinationAction destination="directMessages">
				<Button
					aria-label="New chat"
					onClick={() => newChat()}
					size="icon-sm"
					variant="ghost"
				>
					<PlusIcon />
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								aria-label="Filter chats"
								size="icon-sm"
								variant="ghost"
							/>
						}
					>
						<FunnelSimpleIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-60">
						<DropdownMenuItem onClick={() => setSearchOpen(true)}>
							Search chats
						</DropdownMenuItem>
						{categoryFilter.menu}
						<DropdownMenuCheckboxItem
							checked={archived}
							onCheckedChange={setArchived}
						>
							Archived chats
						</DropdownMenuCheckboxItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarDestinationAction>
			<NewDirectMessageDialog
				groupId={creatingGroup}
				onCreated={creatingGroup ? (id) => move(creatingGroup, id) : undefined}
				onOpenChange={setCreating}
				open={creating}
			/>
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
					ariaLabel="Chats"
					groups={visibleSections.map((section) => ({
						id: section.id,

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
								disabled={store.disabled || pin.arePinActionsPending}
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
								onNewGroup={addGroup}
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
									["priority", "Priority"],
									["recent", "Recent activity"],
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
									activeLayoutId="chat-selection"
									activeValue={selected}
									aria-label={section.name}
								>
									{rows(section.id).map((chat, index) => (
										<ChatRow
											activeWakeSummary={indicators.activeWakeSummaryBySpaceId.get(
												chat.spaceId
											)}
											archived={archived}
											attentionTone={resolveInboxAttentionTone(
												attentionById.get(chat.spaceId) ?? {}
											)}
											chat={chat}
											disabled={store.disabled || pin.arePinActionsPending}
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
											onUnpin={() => unpin(chat.spaceId)}
											profileId={chat.viewerProfileId ?? profileId}
											section={section.id}
											selected={selected === chat.spaceId}
											title={title(chat)}
											unreadCount={
												indicators.unreadBySpaceId.get(chat.spaceId)
													?.unreadCount ?? 0
											}
											url={chatPath(chat)}
										/>
									))}
								</FluidNavMenu>
							</SidebarDropSection>
						),
					}))}
					leadingContent={
						<>
							{visibleSections.length === 0 && (
								<div className="group/sidebar-group-root flex items-center justify-between px-1">
									<Button onClick={() => newChat()} variant="ghost">
										New chat
									</Button>
									<SidebarSectionActions
										addLabel="Add chat or group"
										disabled={store.disabled || pin.arePinActionsPending}
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
										sort={preferences.spaces.sort}
									/>
								</div>
							)}
							{categoryFilter.badges}
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
							{(sessions.isPending ||
								spaces.isPending ||
								directory.isPending) && (
								<SidebarListSkeleton
									label="Loading chats"
									rowCount={2}
									showPreview
								/>
							)}
							{(sessions.isError || spaces.isError || directory.isError) && (
								<Button
									onClick={() => {
										sessions.refetch();
										spaces.refetch();
										directory.refetch();
									}}
									variant="ghost"
								>
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
