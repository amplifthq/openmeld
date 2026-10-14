import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
import {
	FluidDropdownMenuContent as DropdownMenuContent,
	FluidDropdownMenuItem as DropdownMenuItem,
	FluidDropdownMenuGroup,
} from "@openmeld/ui/fluid/dropdown-menu";
import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import {
	SidebarMenuActions,
	SidebarMenuBadge,
	SidebarMenuButton,
} from "@openmeld/ui/fluid/sidebar-menu";
import {
	ArchiveIcon,
	ArrowUUpLeftIcon,
	ChatCircleTextIcon,
	DotsThreeIcon,
	FolderIcon,
	PencilSimpleIcon,
	PushPinIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ObjectMenuItems } from "#/components/app/object-menu-items";
import { useSortableSidebarItem } from "#/components/app/sidebar-drag";
import { SidebarRowAction } from "#/components/app/sidebar-row-action";
import {
	resolveInboxAttentionLabel,
	resolveInboxIndicatorClassName,
} from "#/lib/inbox/attention";
import {
	buildSpaceActivityFocusHref,
	buildSpaceMessageFocusHref,
} from "#/lib/spaces/thread-navigation";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import {
	readCurrentSpaceWakeProgressSummaryItems,
	spaceActiveWakeProgressSummaryQueryOptions,
} from "#/query/spaces/active-wake-progress";
import { spaceBootstrapQueryOptions } from "#/query/spaces/bootstrap";
import { CenterAgentChatAvatar } from "../organizations/center-agent-chat-avatar";
import type { Chat } from "./chat-sidebar-model";
import type {
	Conversation,
	ConversationPreview,
} from "./conversation-sidebar-model";
import { DirectMessageAvatar } from "./direct-message-avatar";
import {
	resolveConversationTimestamp,
	SidebarConversationTime,
} from "./sidebar-conversation-time";
import { SpaceActiveWakeIndicator } from "./space-active-wake-indicator";
import {
	resolveSpaceActiveWakePresentation,
	resolveSpaceActiveWakeTarget,
	type SpaceActiveWakePresentation,
	type SpaceSidebarActiveWakeSummary,
} from "./space-active-wake-presentation";
import { SpaceDeletedLabel } from "./space-deleted-label";
import {
	type SpaceMemberAppearance,
	SpaceMemberAvatars,
} from "./space-member-avatars";
import { SpaceUnreadLink } from "./space-unread-link";

type ConversationSidebarRowProps = {
	showMessagePreviews?: boolean;
	attentionTone: "danger" | "warning" | null;
	index: number;
	profileId: string;
	unreadCount: number;
	messageUnreadCount?: number;
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

type ConversationRowPreview = {
	timestamp: number | null;
	previewText: string;
	previewSignalId?: string;
};

const CONVERSATION_PREVIEW_CLASS_NAME =
	"min-h-4 truncate font-normal text-muted-foreground/90 text-xs leading-4 dark:text-muted-foreground/80";

export function ConversationSidebarRow(input: ConversationSidebarRowProps) {
	if (input.conversation.kind === "space") {
		const item = input.conversation.item;
		return (
			<ConversationSidebarRowContent
				{...input}
				previewSignalId={item.messagePreview?.signalId}
				previewText={item.messagePreview?.text ?? ""}
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
	const preview =
		input.conversation.kind === "direct-message"
			? input.conversation.preview
			: undefined;
	const createdAt =
		input.conversation.kind === "direct-message"
			? input.conversation.chat.createdAt
			: null;
	return (
		<ConversationSidebarRowContent
			{...input}
			previewSignalId={preview?.data?.signalId}
			previewText={resolvePreviewText(preview)}
			timestamp={resolveConversationTimestamp(
				preview?.data?.timestamp,
				createdAt
			)}
		/>
	);
}

function ConversationSidebarRowTime({ timestamp }: { timestamp: number }) {
	const nowMs = useNowMs(60_000);
	return (
		<SidebarConversationTime
			hideOlderUntilHover
			now={new Date(nowMs)}
			timestamp={timestamp}
		/>
	);
}

function renderConversationPreview(
	input: ConversationSidebarRowProps & ConversationRowPreview,
	needsInput: boolean | undefined,
	statusLabel: string | undefined
) {
	if (needsInput) {
		return (
			<span className={CONVERSATION_PREVIEW_CLASS_NAME}>{statusLabel}</span>
		);
	}
	if (input.previewSignalId) {
		return (
			<ConversationPreviewLink
				signalId={input.previewSignalId}
				text={input.previewText}
				title={input.title}
				url={input.url}
			/>
		);
	}
	return (
		<span className={CONVERSATION_PREVIEW_CLASS_NAME}>{input.previewText}</span>
	);
}

function conversationRowClassName(pinned: boolean, hasPreviewLine: boolean) {
	if (pinned) {
		return "group/chat relative [&>[data-sidebar=menu-actions]]:top-1 [&>[data-sidebar=menu-actions]]:right-0 [&>[data-sidebar=menu-badge]]:top-10 [&>[data-sidebar=menu-badge]]:right-1";
	}
	return hasPreviewLine
		? "group/chat relative"
		: "group/chat relative [&>[data-sidebar=menu-actions]]:top-1/2 [&>[data-sidebar=menu-actions]]:-translate-y-1/2 [&>[data-sidebar=menu-badge]]:top-1/2 [&>[data-sidebar=menu-badge]]:-translate-y-1/2";
}

function ConversationSidebarRowContent(
	input: ConversationSidebarRowProps & ConversationRowPreview
) {
	const { timestamp, previewText } = input;
	const pinned = input.section === "pinned";
	const rowAnchor = useRef<HTMLDivElement>(null);
	const presentation = input.activeWakeSummary
		? resolveSpaceActiveWakePresentation(input.activeWakeSummary)
		: null;
	const hasUnread = input.unreadCount > 0;

	const needsInput = input.activeWakeSummary?.statuses?.some(
		(status) => status.kind === "needs_input"
	);
	const hasPreviewLine =
		needsInput || (input.showMessagePreviews !== false && !!previewText);
	const drag = useSortableSidebarItem({
		section: input.section,
		itemId: input.conversation.spaceId,
		name: input.title,
		disabled: input.disabled || !!input.dragDisabled,
	});
	const row = (
		<FluidNavMenuItem
			className={conversationRowClassName(pinned, !!hasPreviewLine)}
			index={input.index}
			ref={drag.ref}
			style={drag.style}
			value={input.conversation.spaceId}
		>
			<SidebarMenuButton
				actionLayout="heading"
				asChild
				className={
					pinned
						? "h-auto px-1 [&_[data-sidebar=menu-heading]]:pr-0!"
						: "h-auto"
				}
				isActive={input.selected}
			>
				<div
					className={`relative flex w-full min-w-0 items-center ${pinned ? "min-h-26 flex-col justify-center gap-1.5 px-1 py-2 text-xs" : "min-h-12 gap-2 px-2 py-1.5 text-sm"} ${input.selected ? "font-medium text-sidebar-accent-foreground" : "text-muted-foreground"}`}
					ref={rowAnchor}
				>
					<Tooltip>
						<TooltipTrigger
							render={
								<Link
									{...drag.rowProps}
									aria-current={input.selected ? "page" : undefined}
									aria-label={[
										input.title,
										resolveInboxAttentionLabel(input.attentionTone),
										hasUnread ? "unread updates" : null,
										presentation?.label,
									]
										.filter(Boolean)
										.join(", ")}
									className="flex shrink-0 items-center rounded-md outline-none before:absolute before:inset-0 before:rounded-md focus-visible:before:ring-1 focus-visible:before:ring-ring [&_canvas[data-bot-avatar]]:relative"
									resetScroll={false}
									{...conversationNavigationTarget(input.url)}
								/>
							}
						>
							<ConversationIcon
								conversation={input.conversation}
								memberAppearances={input.memberAppearances}
								pinned={pinned}
								summary={input.activeWakeSummary}
								title={input.title}
							/>
						</TooltipTrigger>
						<TooltipContent
							anchor={rowAnchor}
							className="max-w-sm flex-col items-start whitespace-normal text-left"
							side="right"
						>
							<span>{input.title}</span>
							{presentation && <span>{presentation.label}</span>}
						</TooltipContent>
					</Tooltip>
					<span className="pointer-events-none contents">
						<span
							className={`flex min-w-0 flex-col gap-0.5 ${pinned ? "w-full flex-none text-center" : "flex-1"}`}
						>
							<span
								className="flex min-w-0 items-center gap-2"
								data-sidebar="menu-heading"
							>
								<span className="flex min-w-0 flex-1 items-center gap-1.5">
									<span
										className={`min-w-0 flex-1 text-foreground ${pinned ? "line-clamp-2 break-words leading-4" : "truncate"} ${hasUnread ? "font-semibold" : ""}`}
										data-conversation-title="true"
									>
										{input.title}
									</span>
									{input.conversation.kind === "space" &&
										input.conversation.item.deletedAt && <SpaceDeletedLabel />}
								</span>
								{!pinned && timestamp !== null && !presentation && (
									<ConversationSidebarRowTime timestamp={timestamp} />
								)}
								{presentation && input.attentionTone && (
									<span
										aria-hidden="true"
										className={`status-dot shrink-0 ${resolveInboxIndicatorClassName(input.attentionTone)}`}
										data-conversation-unread-indicator="true"
									/>
								)}
							</span>
							{!pinned &&
								hasPreviewLine &&
								renderConversationPreview(
									input,
									needsInput,
									presentation?.label
								)}
						</span>
					</span>
				</div>
			</SidebarMenuButton>
			<ConversationRowStatus input={input} presentation={presentation} />

			<ConversationRowActions {...input} />
		</FluidNavMenuItem>
	);
	return (
		<FluidContextMenu className="w-56" target={row}>
			<ConversationRowMenuItems {...input} />
		</FluidContextMenu>
	);
}

function ConversationRowStatus({
	input,
	presentation,
}: {
	input: ConversationSidebarRowProps;
	presentation: SpaceActiveWakePresentation | null;
}) {
	return presentation ? (
		<SidebarMenuBadge className="p-0">
			<ConversationActivityIndicator
				focusSignalId={input.activeWakeSummary?.focusSignalId}
				presentation={presentation}
				profileId={input.profileId}
				spaceId={input.conversation.spaceId}
				title={input.title}
				url={input.url}
			/>
		</SidebarMenuBadge>
	) : (
		(input.unreadCount > 0 || input.attentionTone) && (
			<SidebarMenuBadge>
				{input.attentionTone ? (
					<span
						aria-hidden="true"
						className={`status-dot ${resolveInboxIndicatorClassName(input.attentionTone)}`}
						data-conversation-unread-indicator="true"
					/>
				) : (
					<SpaceUnreadLink
						count={input.unreadCount}
						messageUnreadCount={input.messageUnreadCount}
						spaceId={input.conversation.spaceId}
						url={input.url}
					/>
				)}
			</SidebarMenuBadge>
		)
	);
}

function ConversationPreviewLink(input: {
	url: string;
	signalId: string;
	text: string;
	title: string;
}) {
	const navigate = useNavigate();
	const currentHref = useLocation({ select: (location) => location.href });
	const href = buildSpaceMessageFocusHref(input.url, input.signalId);
	const destination = conversationNavigationTarget(href);
	return (
		<Link
			aria-label={`Open preview message in ${input.title}: ${input.text}`}
			className={`pointer-events-auto relative ${CONVERSATION_PREVIEW_CLASS_NAME} decoration-muted-foreground/50 underline-offset-2 outline-none hover:underline focus-visible:underline focus-visible:ring-1 focus-visible:ring-ring`}
			onClick={(event) => {
				if (
					currentHref !== href ||
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey
				) {
					return;
				}
				event.preventDefault();
				navigate({
					...conversationNavigationTarget(input.url),
					replace: true,
					resetScroll: false,
				})
					.then(() => navigate({ ...destination, resetScroll: false }))
					.catch((error: unknown) => {
						console.error("Could not open preview message", error);
						toast.error("Couldn't open this message. Try again.");
					});
			}}
			resetScroll={false}
			{...destination}
		>
			{input.text}
		</Link>
	);
}

function ConversationActivityIndicator({
	presentation,
	title,
	url,
	profileId,
	spaceId,
	focusSignalId,
}: {
	profileId: string;
	spaceId: string;
	focusSignalId?: string;
	presentation: SpaceActiveWakePresentation;
	title: string;
	url: string;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const currentHref = useLocation({ select: (location) => location.href });
	const [opening, setOpening] = useState(false);
	const navigationAttempt = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Navigation elsewhere invalidates a pending click, even when the sidebar remains mounted.
	useEffect(
		() => () => {
			navigationAttempt.current += 1;
		},
		[currentHref]
	);
	const href = buildSpaceMessageFocusHref(url, focusSignalId);
	const openActivity = async () => {
		const attempt = ++navigationAttempt.current;
		setOpening(true);
		try {
			const progress = await queryClient.fetchQuery(
				spaceActiveWakeProgressSummaryQueryOptions({
					enabled: true,
					openMeldProfileId: profileId,
					spaceId,
				})
			);
			if (attempt !== navigationAttempt.current) {
				return;
			}
			const readTarget = () =>
				resolveSpaceActiveWakeTarget(
					readCurrentSpaceWakeProgressSummaryItems({
						queryClient,
						spaceId,
						openMeldProfileId: profileId,
						summary: progress,
					})
				);
			let target = readTarget();
			const bootstrap = target
				? await queryClient.fetchQuery({
						...spaceBootstrapQueryOptions({
							spaceId,
							openMeldProfileId: profileId,
							enabled: true,
						}),
						staleTime: 0,
					})
				: null;
			if (attempt !== navigationAttempt.current) {
				return;
			}
			target = readTarget();
			const destination =
				target && bootstrap
					? buildSpaceActivityFocusHref({
							url,
							progress: target,
							threads: bootstrap.threads,
							agentStreams: [
								...(bootstrap.activeAgentStreams ?? []),
								...(bootstrap.activeAgentStreamPresences ?? []),
							],
						})
					: url;
			if (!target) {
				toast.info("This work has finished. Opening the conversation.");
			}
			// Reset a previously consumed focus request so repeating this action scrolls again.
			if (currentHref === destination && destination !== url) {
				await navigate({
					...conversationNavigationTarget(url),
					replace: true,
					resetScroll: false,
				});
			}
			await navigate({
				...conversationNavigationTarget(destination),
				resetScroll: false,
			});
		} catch (error) {
			console.error("Could not open active work", error);
			toast.error(
				"Couldn't find the active work. Open the conversation or try again."
			);
		} finally {
			setOpening(false);
		}
	};
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Link
						aria-busy={opening}
						aria-label={`${presentation.label}. Find active work in ${title}`}
						className="pointer-events-auto inline-flex shrink-0 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
						onClick={(event) => {
							if (
								event.button !== 0 ||
								event.metaKey ||
								event.ctrlKey ||
								event.shiftKey ||
								event.altKey
							) {
								return;
							}
							event.preventDefault();
							if (!opening) {
								openActivity();
							}
						}}
						resetScroll={false}
						{...conversationNavigationTarget(href)}
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

function conversationNavigationTarget(href: string) {
	const url = new URL(href, "https://openmeld.invalid");
	return {
		to: url.pathname,
		search: Object.fromEntries(url.searchParams),
		hash: url.hash.slice(1),
	};
}

function ConversationIcon(input: {
	pinned?: boolean;
	conversation: Conversation;
	title: string;
	summary?: SpaceSidebarActiveWakeSummary;
	memberAppearances?: ReadonlyMap<string, SpaceMemberAppearance>;
}) {
	if (input.conversation.kind === "direct-message") {
		return (
			<ChatIcon
				chat={input.conversation.chat}
				size={input.pinned ? "md" : "sidebar"}
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
				compactSize={input.pinned ? 48 : 24}
				members={members}
			/>
		);
	}
	return (
		<ChatCircleTextIcon
			aria-label="Space"
			className={input.pinned ? "size-12 shrink-0" : "size-6 shrink-0"}
		/>
	);
}

export function resolvePreviewText(
	preview: ConversationPreview | undefined
): string {
	if (preview?.data) {
		return preview.data.text;
	}
	if (preview?.isError) {
		return "Couldn’t load preview. Open chat to retry.";
	}
	return "";
}

export function ChatIcon(input: {
	chat: Chat;
	title: string;
	size?: "sm" | "sidebar" | "card" | "md";
	summary?: SpaceSidebarActiveWakeSummary;
}) {
	if (input.chat.session) {
		return (
			<CenterAgentChatAvatar
				avatarStyle={input.chat.centerAgentAvatarStyle}
				profileId={input.chat.centerAgentProfileId}
				profileName={input.chat.centerAgentProfileName}
				size={
					({ card: 56, sidebar: 28, sm: 24, md: 48 } as const)[
						input.size ?? "sm"
					]
				}
				working={
					input.summary?.statuses?.some(
						(status) => status.kind === "working"
					) ?? false
				}
			/>
		);
	}
	return (
		<DirectMessageAvatar
			participants={input.chat.participants}
			peer={input.chat.peer}
			size={input.size ?? "sm"}
		/>
	);
}

function ConversationRowActions(input: ConversationSidebarRowProps) {
	const togglePin = () =>
		input.section === "pinned" ? input.onUnpin() : input.onMove("pinned");
	return (
		<SidebarMenuActions showOnHover>
			{input.section !== "pinned" && (
				<SidebarRowAction
					disabled={input.disabled}
					label={`${input.section === "pinned" ? "Unpin" : "Pin"} ${input.title}`}
					onClick={togglePin}
				>
					<PushPinIcon
						weight={input.section === "pinned" ? "fill" : "regular"}
					/>
				</SidebarRowAction>
			)}
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
				<DropdownMenuContent
					align="end"
					className="w-56 max-w-[calc(100vw-2rem)]"
				>
					<ConversationRowMenuItems {...input} />
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarMenuActions>
	);
}

function ConversationRowMenuItems(input: ConversationSidebarRowProps) {
	const togglePin = () =>
		input.section === "pinned" ? input.onUnpin() : input.onMove("pinned");
	return (
		<>
			<ObjectMenuItems href={input.url} />
			<DropdownMenuSeparator />
			<FluidDropdownMenuGroup>
				{input.onRename && (
					<DropdownMenuItem
						disabled={input.disabled}
						index={0}
						onClick={input.onRename}
					>
						<PencilSimpleIcon aria-hidden="true" />
						Rename
					</DropdownMenuItem>
				)}
				<DropdownMenuItem
					disabled={input.disabled}
					index={1}
					onClick={togglePin}
				>
					<PushPinIcon
						aria-hidden="true"
						weight={input.section === "pinned" ? "fill" : "regular"}
					/>
					{input.section === "pinned" ? "Unpin" : "Pin"}
				</DropdownMenuItem>
				{input.groups
					.filter((g) => g.id !== input.section && g.id !== "pinned")
					.map((g, index) => (
						<DropdownMenuItem
							disabled={input.disabled}
							index={index + 2}
							key={g.id}
							onClick={() => input.onMove(g.id)}
						>
							<FolderIcon aria-hidden="true" />
							<span className="truncate" title={`Move to ${g.name}`}>
								Move to {g.name}
							</span>
						</DropdownMenuItem>
					))}
			</FluidDropdownMenuGroup>
			{input.onArchive && (
				<>
					<DropdownMenuSeparator />
					<FluidDropdownMenuGroup>
						<DropdownMenuItem
							disabled={input.disabled}
							index={input.groups.length + 2}
							onClick={input.onArchive}
						>
							{input.archived ? (
								<ArrowUUpLeftIcon aria-hidden="true" />
							) : (
								<ArchiveIcon aria-hidden="true" />
							)}
							{input.archived ? "Unarchive" : "Archive"}
						</DropdownMenuItem>
					</FluidDropdownMenuGroup>
				</>
			)}
		</>
	);
}
