import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import {
	ChatCircleTextIcon,
	FunnelSimpleIcon,
	PlusIcon,
	SortAscendingIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppEmptyState } from "#/components/app/app-empty-state";
import { AppMainContent } from "#/components/app/app-main-content";
import { useSidebarFilter } from "#/components/app/sidebar-filter";
import { SidebarListSkeleton } from "#/components/app/sidebar-list-skeleton";
import {
	resolveInboxAttentionLabel,
	resolveInboxAttentionTone,
	resolveInboxIndicatorClassName,
} from "#/lib/inbox/attention";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { ChatIcon, resolvePreviewText } from "./chat-sidebar-row";
import { NewChatDialog } from "./new-chat-dialog";
import { SidebarConversationTime } from "./sidebar-conversation-time";
import { SpaceWindowHeader } from "./space-header";
import { useChats } from "./use-chats";

export function ChatsDirectory() {
	const [creating, setCreating] = useState(false);
	const [search, setSearch] = useState("");
	const filter = useSidebarFilter(
		[
			{ id: "human", label: "People" },
			{ id: "agent", label: "Agents" },
		],
		"All chats"
	);
	const model = useChats({
		currentSpaceId: "",
		search,
		archived: false,
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
	const sections = model.sections
		.map((section) => ({ ...section, chats: model.rows(section.id) }))
		.filter((section) => section.chats.length > 0);
	const newChat = (
		<Button onClick={() => setCreating(true)} size="sm">
			<PlusIcon />
			New chat
		</Button>
	);
	return (
		<AppMainContent
			bodyClassName="p-6"
			header={
				<SpaceWindowHeader
					actions={newChat}
					leadingControl={
						<ChatCircleTextIcon className="size-4 text-muted-foreground" />
					}
					renderFrame={false}
					title="Chats"
				/>
			}
			scroll
		>
			<div className="mb-6 flex items-center justify-between gap-3">
				<span className="text-muted-foreground text-sm">
					{pending || model.sessions.hasNextPage
						? "Loading chats…"
						: `${model.chats.filter((chat) => !model.preferences.archivedIds.includes(chat.spaceId)).length} chats`}
				</span>
				<div className="flex items-center gap-2">
					<Input
						aria-label="Search chats"
						className="max-w-64"
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search chats"
						type="search"
						value={search}
					/>
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
						<DropdownMenuContent align="end">{filter.menu}</DropdownMenuContent>
					</DropdownMenu>
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
					Could not load chats. Retry
				</Button>
			)}
			{pending && sections.length === 0 && (
				<SidebarListSkeleton label="Loading chats" rowCount={4} showPreview />
			)}
			{!(pending || failed || model.sessions.hasNextPage) &&
				sections.length === 0 && (
					<AppEmptyState
						actions={newChat}
						description={
							search || filter.selected.length
								? "Try another search or remove a filter."
								: "Choose a person or agent to chat with, or select several to start a Space."
						}
						icon={<ChatCircleTextIcon />}
						title={
							search || filter.selected.length
								? "No matching chats"
								: "Start a conversation"
						}
					/>
				)}
			{sections.map((section) => (
				<section className="mb-8" key={section.id}>
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-muted-foreground text-sm">
							{section.name}{" "}
							<span className="ml-1">{section.chats.length}</span>
						</h2>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										aria-label={`Sort ${section.name}`}
										size="icon-sm"
										variant="ghost"
									/>
								}
							>
								<SortAscendingIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{(
									[
										["priority", "Priority"],
										["recent", "Recent activity"],
										["manual", "Manual order"],
									] as const
								).map(([value, label]) => (
									<DropdownMenuCheckboxItem
										checked={section.sort === value}
										key={value}
										onCheckedChange={() => model.sortSection(section.id, value)}
									>
										{label}
									</DropdownMenuCheckboxItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Chat</TableHead>
								<TableHead className="w-40">Status</TableHead>
								<TableHead className="w-28">Activity</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
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
									<TableRow key={chat.spaceId}>
										<TableCell className="max-w-0">
											<Link
												className="flex items-center gap-3 py-2"
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
														className={unread ? "font-semibold" : "font-medium"}
													>
														{model.title(chat)}
													</span>
													<span className="mt-1 block truncate text-muted-foreground text-sm">
														{preview
															? resolvePreviewText(preview)
															: "Loading message…"}
													</span>
												</span>
											</Link>
										</TableCell>
										<TableCell>
											{(unread > 0 || tone) && (
												<span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
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
													className="text-sm"
													now={new Date(now)}
													timestamp={time}
												/>
											) : null}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</section>
			))}
			<NewChatDialog onOpenChange={setCreating} open={creating} />
		</AppMainContent>
	);
}
