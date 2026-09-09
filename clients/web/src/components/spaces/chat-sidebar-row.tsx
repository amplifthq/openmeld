import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import {
	SidebarMenuActions,
	SidebarMenuButton,
} from "@openmeld/ui/fluid/sidebar-menu";
import { CloudIcon, DotsThreeIcon, PushPinIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useSortableSidebarItem } from "#/components/app/sidebar-drag";
import { SidebarRowAction } from "#/components/app/sidebar-row-action";
import {
	resolveInboxAttentionLabel,
	resolveInboxIndicatorClassName,
} from "#/lib/inbox/attention";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { CenterAgentChatAvatar } from "../organizations/center-agent-chat-avatar";
import type { Chat } from "./chat-sidebar-model";
import { useSpaceMessagePreview } from "./direct-message-preview";
import {
	resolveConversationTimestamp,
	SidebarConversationTime,
} from "./sidebar-conversation-time";
import { SpaceActiveWakeIndicator } from "./space-active-wake-indicator";
import {
	resolveSpaceActiveWakePresentation,
	type SpaceSidebarActiveWakeSummary,
} from "./space-active-wake-presentation";
import { SpaceProfileIcon } from "./space-profile-icon";

export function ChatRow(input: {
	attentionTone: "danger" | "warning" | null;
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
	const togglePin = () =>
		input.section === "pinned" ? input.onUnpin() : input.onMove("pinned");
	const previewText = resolvePreviewText(preview);
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
						resolveInboxAttentionLabel(input.attentionTone),
						hasUnread ? "unread messages" : null,
						presentation?.label,
					]
						.filter(Boolean)
						.join(", ")}
					className={`flex min-h-12 w-full min-w-0 items-center gap-2 px-2 py-1.5 text-sm outline-none ${input.selected ? "font-medium text-sidebar-accent-foreground" : "text-muted-foreground"}`}
					to={input.url}
				>
					<ChatIcon
						chat={input.chat}
						summary={input.activeWakeSummary}
						title={input.title}
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
							{input.chat.session && (
								<Tooltip>
									<TooltipTrigger
										render={
											<span
												aria-label={input.chat.session ? "Agent chat" : "Chat"}
												className="inline-flex shrink-0 text-muted-foreground"
												role="img"
											/>
										}
									>
										<CloudIcon aria-hidden="true" className="size-3" />
									</TooltipTrigger>
									<TooltipContent>
										{input.chat.session ? "Agent chat" : "Chat"}
									</TooltipContent>
								</Tooltip>
							)}
							{timestamp !== null && (
								<SidebarConversationTime
									now={new Date(nowMs)}
									timestamp={timestamp}
								/>
							)}
							{(hasUnread || input.attentionTone) && (
								<span
									aria-hidden="true"
									className={`status-dot shrink-0 ${resolveInboxIndicatorClassName(input.attentionTone)}`}
									data-chat-unread-indicator="true"
								/>
							)}
						</span>
						<span className="truncate font-normal text-muted-foreground text-xs leading-4">
							{needsInput ? presentation?.label : previewText}
						</span>
					</span>
				</Link>
			</SidebarMenuButton>
			<SidebarMenuActions showOnHover>
				<SidebarRowAction
					disabled={input.disabled}
					label={`${input.section === "pinned" ? "Unpin" : "Pin"} ${input.title}`}
					onClick={togglePin}
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
						<DropdownMenuItem disabled={input.disabled} onClick={togglePin}>
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

function resolvePreviewText(
	preview: ReturnType<typeof useSpaceMessagePreview>
): string {
	if (preview.data) {
		return preview.data.text;
	}
	if (preview.isError) {
		return "Couldn’t load preview. Open chat to retry.";
	}
	if (preview.isPending) {
		return "Loading message…";
	}
	return "No messages yet";
}

function ChatIcon(input: {
	chat: Chat;
	title: string;
	summary?: SpaceSidebarActiveWakeSummary;
}) {
	if (input.chat.session) {
		return (
			<CenterAgentChatAvatar
				working={
					input.summary?.statuses?.some(
						(status) => status.kind === "working"
					) ?? false
				}
			/>
		);
	}
	return (
		<SpaceProfileIcon
			agentControllerRef={input.chat.peer?.agentControllerRef ?? null}
			avatarImageUrl={input.chat.peer?.avatarUrl}
			profileId={input.chat.peer?.profileId ?? input.chat.spaceId}
			profileKind={input.chat.peer?.profileKind ?? "human"}
			profileName={input.title}
			size="sm"
		/>
	);
}
