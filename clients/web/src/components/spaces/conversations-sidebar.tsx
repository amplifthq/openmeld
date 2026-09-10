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
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { FunnelSimpleIcon, ListIcon, PlusIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { resolveInboxAttentionTone } from "#/lib/inbox/attention";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationNewSpacePath } from "#/lib/organizations/organization-routes";
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

export function ConversationsSidebar(
	input: { currentProfileId?: string; currentSpaceId?: string } = {}
) {
	const model = useConversations(input);
	const { directMessages: dm } = model;
	const memberAppearances = useMemo(
		() => resolveSpaceMemberAppearances(dm.directory.data),
		[dm.directory.data]
	);
	const { currentUserId } = useAppOrganization();
	const { view, setView } = useConversationView(currentUserId, dm.org.id);
	const [search, setSearch] = useState("");
	const [archived, setArchived] = useState(false);
	const [creating, setCreating] = useState(false);
	const [creatingGroup, setCreatingGroup] = useState<string>();
	const [renaming, setRenaming] = useState<Conversation | null>(null);
	const [name, setName] = useState("");
	const navigate = useNavigate();
	const kinds = useSidebarFilter(
		[
			{ id: "space", label: "Spaces" },
			{ id: "human", label: "People" },
			{ id: "agent", label: "Agents" },
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
	const rows = (section: ConversationSection) =>
		model.sort(
			filtered.filter((item) =>
				section.id === "recent"
					? model.owner(item) !== "pinned"
					: model.owner(item) === section.id
			),
			section
		);
	const visible = sections.filter(
		(section) =>
			rows(section).length > 0 ||
			(view === "grouped" &&
				section.id !== "pinned" &&
				!search.trim() &&
				!filter.active &&
				!archived)
	);
	const pending =
		dm.store.isPending ||
		dm.spaces.isPending ||
		dm.sessions.isPending ||
		dm.directory.isPending;
	const failed =
		dm.store.isError ||
		dm.spaces.isError ||
		dm.sessions.isError ||
		dm.directory.isError;
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
	const newMessage = (groupId?: string) => {
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
	return (
		<>
			<div className="mb-2 flex min-w-0 items-center gap-1 px-1">
				<span className="min-w-0 flex-1 truncate font-medium text-sm">
					Conversations
				</span>
				<Button
					aria-label="New conversation"
					onClick={() => newMessage()}
					size="icon-sm"
					variant="ghost"
				>
					<PlusIcon />
				</Button>
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
					<DropdownMenuContent align="end">
						<DropdownMenuRadioGroup
							onValueChange={(value) => {
								if (value === "grouped" || value === "recent") {
									setView(value);
								}
							}}
							value={view}
						>
							<DropdownMenuRadioItem closeOnClick value="grouped">
								Grouped
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem closeOnClick value="recent">
								Recent
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
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
						{kinds.menu}
						<DropdownMenuSeparator />
						{filter.menu}
						<DropdownMenuSeparator />
						<DropdownMenuCheckboxItem
							checked={archived}
							onCheckedChange={setArchived}
						>
							Archived direct messages
						</DropdownMenuCheckboxItem>
					</DropdownMenuContent>
				</DropdownMenu>
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
			{!(pending || failed) && filtered.length === 0 && (
				<p className="p-2 text-muted-foreground text-xs">
					{search.trim() || filter.active || archived
						? "No conversations match your search or filters."
						: "No conversations yet."}
				</p>
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
										rows(section).some((item) =>
											dm.indicators.unreadBySpaceId.has(item.spaceId)
										) && (
											<span className="mr-1 text-muted-foreground text-xs">
												Unread
											</span>
										)}
									{view === "grouped" && section.id !== "pinned" && (
										<SidebarSectionActions
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
			<NewChatDialog
				groupId={creatingGroup?.slice(5)}
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
															...group.spaceIds.filter((value) => value !== id),
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
