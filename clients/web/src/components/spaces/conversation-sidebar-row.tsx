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
	SidebarMenuBadge,
	SidebarMenuButton,
} from "@openmeld/ui/fluid/sidebar-menu";
import {
	ChatCircleTextIcon,
	CloudIcon,
	DotsThreeIcon,
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
	type SpaceActiveWakePresentation,
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

type ConversationRowPreview = { timestamp: number | null; previewText: string };

export function ConversationSidebarRow(input: ConversationSidebarRowProps) {
	if (input.conversation.kind === "space") {
		const item = input.conversation.item;
		return (
			<ConversationSidebarRowContent
				{...input}
				previewText={item.messagePreview?.text ?? "No messages yet"}
				timestamp={resolveConversationTimestamp(
					item.messagePreview?.timestamp,
					item.spaceCreatedAt
				)}
			/>
		);
	}
	return <DirectMessageSidebarRow {...input} />;
}

function DirectMessageSidebarRow(input: ConversationSidebarRowProps) {
	const preview = useSpaceMessagePreview({
		spaceId: input.conversation.spaceId,
		viewerProfileId: input.profileId,
		enabled: !!input.profileId,
	});
	const createdAt =
		input.conversation.kind === "direct-message"
			? input.conversation.chat.createdAt
			: null;
	return (
		<ConversationSidebarRowContent
			{...input}
			previewText={resolvePreviewText(preview)}
			timestamp={resolveConversationTimestamp(
				preview.data?.timestamp,
				createdAt
			)}
		/>
	);
}

function ConversationSidebarRowContent(
	input: ConversationSidebarRowProps & ConversationRowPreview
) {
	const chat =
		input.conversation.kind === "direct-message"
			? input.conversation.chat
			: null;
	const { timestamp, previewText } = input;
	const nowMs = useNowMs(timestamp === null ? null : 60_000);
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
			<Tooltip>
				<TooltipTrigger
					render={
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
												data-conversation-title="true"
											>
												{input.title}
											</span>
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
										{timestamp !== null && !presentation && (
											<SidebarConversationTime
												now={new Date(nowMs)}
												timestamp={timestamp}
											/>
										)}
										{presentation && input.attentionTone && (
											<span
												aria-hidden="true"
												className={`status-dot shrink-0 ${resolveInboxIndicatorClassName(input.attentionTone)}`}
												data-conversation-unread-indicator="true"
											/>
										)}
									</span>
									<span className="truncate font-normal text-muted-foreground text-xs leading-4">
										{needsInput ? presentation?.label : previewText}
									</span>
								</span>
							</Link>
						</SidebarMenuButton>
					}
				/>
				<TooltipContent
					className="max-w-sm flex-col items-start whitespace-normal text-left"
					side="right"
				>
					<span>{input.title}</span>
					{presentation && <span>{presentation.label}</span>}
				</TooltipContent>
			</Tooltip>
			{presentation ? (
				<SidebarMenuBadge className="p-0">
					<ConversationActivityIndicator
						presentation={presentation}
						title={input.title}
						url={input.url}
					/>
				</SidebarMenuBadge>
			) : (
				(hasUnread || input.attentionTone) && (
					<SidebarMenuBadge>
						<span
							aria-hidden="true"
							className={`status-dot ${resolveInboxIndicatorClassName(input.attentionTone)}`}
							data-conversation-unread-indicator="true"
						/>
					</SidebarMenuBadge>
				)
			)}

			<ConversationRowActions {...input} />
		</FluidNavMenuItem>
	);
}

function ConversationActivityIndicator({
	presentation,
	title,
	url,
}: {
	presentation: SpaceActiveWakePresentation;
	title: string;
	url: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Link
						aria-label={`${presentation.label}. Open ${title}`}
						className="pointer-events-auto inline-flex shrink-0 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
						resetScroll={false}
						to={url}
					/>
				}
			>
				<span
					aria-label={presentation.label}
					className="inline-flex"
					data-conversation-activity={
						presentation.isWaitingForCurrentTask ? "waiting" : "active"
					}
					role="img"
				>
					<SpaceActiveWakeIndicator presentation={presentation} />
				</span>
			</TooltipTrigger>
			<TooltipContent side="top">{presentation.label}</TooltipContent>
		</Tooltip>
	);
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
	return <ChatCircleTextIcon aria-label="Space" className="size-5 shrink-0" />;
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
