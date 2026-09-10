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
import {
	CloudIcon,
	DotsThreeIcon,
	HashIcon,
	PushPinIcon,
} from "@phosphor-icons/react";
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
import type { Conversation } from "./conversation-sidebar-model";
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
import {
	type SpaceMemberAppearance,
	SpaceMemberAvatars,
} from "./space-member-avatars";
import { SpaceProfileIcon } from "./space-profile-icon";

type ConversationSidebarRowProps = {
	attentionTone: "danger" | "warning" | null;
	index: number;
	profileId: string;
	unreadCount: number;
	activeWakeSummary?: SpaceSidebarActiveWakeSummary;
	conversation: Conversation;
	dragDisabled?: boolean;
	memberAppearances?: ReadonlyMap<string, SpaceMemberAppearance>;
	title: string;
	section: string;
	selected: boolean;
	disabled: boolean;
	url: string;
	groups: { id: string; name: string }[];
	onMove: (id: string) => void;
	archived: boolean;
	onArchive?: () => void;
	onRename?: () => void;
	onUnpin: () => void;
};

export function ConversationSidebarRow(input: ConversationSidebarRowProps) {
	const chat =
		input.conversation.kind === "direct-message"
			? input.conversation.chat
			: null;
	const space =
		input.conversation.kind === "space" ? input.conversation.item : null;
	const preview = useSpaceMessagePreview({
		spaceId: input.conversation.spaceId,
		viewerProfileId: input.profileId,
		enabled: !!input.profileId && !space,
	});
	const nowMs = useNowMs(preview.data ? 60_000 : null);
	const { timestamp, previewText } = conversationPreview(
		input.conversation,
		preview
	);
	const presentation = input.activeWakeSummary
		? resolveSpaceActiveWakePresentation(input.activeWakeSummary)
		: null;
	const hasUnread = input.unreadCount > 0;

	const needsInput = input.activeWakeSummary?.statuses?.some(
		(status) => status.kind === "needs_input"
	);
	const drag = useSortableSidebarItem({
		section: input.section,
		itemId: input.conversation.spaceId,
		name: input.title,
		disabled: input.disabled || !!input.dragDisabled,
	});
	return (
		<FluidNavMenuItem
			className="group/chat relative"
			index={input.index}
			ref={drag.ref}
			style={drag.style}
			value={input.conversation.spaceId}
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
					resetScroll={false}
					to={input.url}
				>
					<ConversationIcon
						conversation={input.conversation}
						memberAppearances={input.memberAppearances}
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
							{chat?.session && (
								<Tooltip>
									<TooltipTrigger
										render={
											<span
												aria-label="Agent direct message"
												className="inline-flex shrink-0 text-muted-foreground"
												role="img"
											/>
										}
									>
										<CloudIcon aria-hidden="true" className="size-3" />
									</TooltipTrigger>
									<TooltipContent>Agent direct message</TooltipContent>
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
			<ConversationRowActions {...input} />
		</FluidNavMenuItem>
	);
}

function conversationPreview(
	conversation: Conversation,
	preview: ReturnType<typeof useSpaceMessagePreview>
) {
	if (conversation.kind === "space") {
		return {
			timestamp: resolveConversationTimestamp(
				conversation.item.messagePreview?.timestamp,
				conversation.item.spaceCreatedAt
			),
			previewText: conversation.item.messagePreview?.text ?? "No messages yet",
		};
	}
	return {
		timestamp: resolveConversationTimestamp(
			preview.data?.timestamp,
			conversation.chat.createdAt
		),
		previewText: resolvePreviewText(preview),
	};
}

function ConversationIcon(input: {
	conversation: Conversation;
	title: string;
	summary?: SpaceSidebarActiveWakeSummary;
	memberAppearances?: ReadonlyMap<string, SpaceMemberAppearance>;
}) {
	if (input.conversation.kind === "direct-message") {
		return (
			<ChatIcon
				chat={input.conversation.chat}
				summary={input.summary}
				title={input.title}
			/>
		);
	}
	const members = input.conversation.item.memberPreviews;
	if (members?.length) {
		return (
			<SpaceMemberAvatars
				appearances={input.memberAppearances}
				members={members}
			/>
		);
	}
	return <HashIcon aria-label="Space" className="size-5 shrink-0" />;
}

export function resolvePreviewText(
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

export function ChatIcon(input: {
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

function ConversationRowActions(input: ConversationSidebarRowProps) {
	const togglePin = () =>
		input.section === "pinned" ? input.onUnpin() : input.onMove("pinned");
	return (
		<SidebarMenuActions showOnHover>
			<SidebarRowAction
				disabled={input.disabled}
				label={`${input.section === "pinned" ? "Unpin" : "Pin"} ${input.title}`}
				onClick={togglePin}
			>
				<PushPinIcon weight={input.section === "pinned" ? "fill" : "regular"} />
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
					{input.onRename && (
						<DropdownMenuItem
							disabled={input.disabled}
							onClick={input.onRename}
						>
							Rename
						</DropdownMenuItem>
					)}
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
					{input.onArchive && (
						<DropdownMenuItem
							disabled={input.disabled}
							onClick={input.onArchive}
						>
							{input.archived ? "Unarchive" : "Archive"}
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarMenuActions>
	);
}
