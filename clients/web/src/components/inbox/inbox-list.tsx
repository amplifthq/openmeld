"use client";

import type { InboxFeedRow, InboxItem } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ChatCircleTextIcon,
	CheckCircleIcon,
	CheckIcon,
	DotsThreeIcon,
	FileTextIcon,
	RobotIcon,
	WarningCircleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import { ObjectMenuItems } from "#/components/app/object-menu-items";
import {
	presentInboxItem,
	useConversationNames,
} from "#/components/spaces/conversation-names";
import {
	resolveInboxIndicatorClassName,
	resolveInboxItemIndicator,
} from "#/lib/inbox/attention";
import { isInboxReview } from "#/lib/inbox/review";
import { requestInboxSourceFocus } from "#/lib/inbox/source-focus-request";
import {
	buildInboxItemSourceNavigation,
	keepInboxFilters,
} from "#/lib/inbox/source-target";
import { useInboxAvatar } from "./inbox-avatars";
import { InvitationReview } from "./invitation-review";

const INBOX_SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});

function InboxLeadingAvatar(input: {
	item: InboxItem;
	compact: boolean;
	inlineInvitation: boolean;
}) {
	const avatar = useInboxAvatar(input.item);
	return (
		<span
			className={cn(
				"relative grid shrink-0 place-items-center text-muted-foreground",
				!avatar && "rounded-md border border-border/70 bg-background",
				input.compact ? "size-8" : "size-9",
				input.inlineInvitation && "size-5 border-0 bg-transparent"
			)}
		>
			{avatar ?? <InboxKindIcon item={input.item} />}
		</span>
	);
}

const INBOX_TIMESTAMP_TITLE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	month: "short",
	timeZone: "UTC",
	timeZoneName: "short",
	year: "numeric",
});

export function InboxItemsList(input: {
	ariaLabel?: string;
	density?: "compact" | "default";
	focusedItemId?: string;
	items: readonly InboxItem[];
	onDismiss?: (item: InboxItem) => void;
	onOpenItem: (item: InboxItem) => void;
	onSetRead: (item: InboxItem, read: boolean) => void;
	organizationSlug: string;
	registerItemElement?: (itemId: string, element: HTMLElement | null) => void;
	showItemActions?: boolean;
}) {
	return (
		<SharedLayoutGroup>
			<ul
				aria-label={input.ariaLabel ?? "Inbox items"}
				className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70 bg-card"
			>
				{input.items.map((item) => (
					<InboxItemRow
						density={input.density ?? "default"}
						focused={input.focusedItemId === item.id}
						item={item}
						key={item.id}
						onDismiss={input.onDismiss}
						onOpenItem={input.onOpenItem}
						onSetRead={input.onSetRead}
						organizationSlug={input.organizationSlug}
						registerItemElement={input.registerItemElement}
						showItemActions={input.showItemActions ?? true}
					/>
				))}
			</ul>
		</SharedLayoutGroup>
	);
}

type InboxItemRowProps = {
	titleOverride?: string;
	previewOverride?: string;
	trailingActions?: ReactNode;
	contextActions?: ReactNode;
	feedRow?: InboxFeedRow;
	children?: ReactNode;
	density: "compact" | "default" | "preview";
	focused: boolean;
	item: InboxItem;
	onDismiss?: (item: InboxItem) => void;
	onOpenItem: (item: InboxItem) => void;
	onSetRead: (item: InboxItem, read: boolean) => void;
	organizationSlug: string;
	registerItemElement?: (itemId: string, element: HTMLElement | null) => void;
	showItemActions: boolean;
};

function useInboxRowNavigation(input: InboxItemRowProps) {
	const sourceNavigation = buildInboxItemSourceNavigation({
		item: input.item,
		orgSlug: input.organizationSlug,
	});
	const navigate = useNavigate();
	const informational =
		input.item.sourceTarget.kind === "desktop_update" &&
		(input.item.sourceTarget.state === "installed" ||
			input.item.sourceTarget.state === "superseded");
	const onOpen = () => {
		input.onOpenItem(input.item);
		if (informational) {
			return;
		}
		if (sourceNavigation.openInNewTab) {
			window.open(sourceNavigation.href, "_blank", "noopener,noreferrer");
			return;
		}
		navigate({
			to: keepInboxFilters({
				currentPathname: window.location.pathname,
				currentSearch: window.location.search,
				href: sourceNavigation.href,
			}),
			state: requestInboxSourceFocus,
		}).catch((error) =>
			console.warn("[openmeld.web.inbox_navigation_failed]", { error })
		);
	};
	return { sourceNavigation, informational, onOpen };
}

const ROW_DENSITY_STYLES = {
	default: {
		actions: "pe-4 pb-2 sm:pb-0",
		layout:
			"grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
		metadata: "mt-2",
		preview: "",
	},
	compact: {
		actions: "pe-4 pb-2 sm:pb-0",
		layout:
			"grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
		metadata: "mt-1",
		preview: "",
	},
	preview: {
		actions: "pe-2",
		layout: "grid grid-cols-[minmax(0,1fr)_auto] items-center",
		metadata: "mt-1",
		preview: "line-clamp-1 text-xs",
	},
};

export function InboxItemRow(input: InboxItemRowProps) {
	const densityStyles = ROW_DENSITY_STYLES[input.density];
	const item = presentInboxItem(input.item, useConversationNames());
	const inlineInvitation = isInlineInvitation(input.density, item);
	const unread = input.feedRow
		? input.feedRow.unreadCount > 0
		: item.readAt === null;
	const { sourceNavigation, informational, onOpen } = useInboxRowNavigation({
		...input,
		item,
	});
	const menu = (
		<>
			{informational ? null : (
				<ObjectMenuItems href={sourceNavigation.href} onOpen={onOpen} />
			)}
			{input.contextActions ?? (
				<InboxItemMenuItems
					item={item}
					onDismiss={input.onDismiss}
					onSetRead={input.onSetRead}
					unread={unread}
				/>
			)}
		</>
	);
	const handleOpen = () => {
		input.onOpenItem(item);
	};
	const handleAuxClick = (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.button === 1) {
			handleOpen();
		}
	};
	const defaultActions = (
		<InboxItemActions
			menu={menu}
			onRead={() => input.onSetRead(item, true)}
			title={item.title}
			unread={unread}
		/>
	);
	const trailingActions =
		input.trailingActions ?? (input.showItemActions ? defaultActions : null);

	return (
		<li>
			<FluidContextMenu
				target={
					<SharedLayoutItem
						className={cn(
							"group/inbox-row relative transition-colors motion-reduce:transition-none",
							unread && "bg-foreground/[0.025]",
							input.focused && "bg-muted/50"
						)}
						data-inbox-focused={input.focused ? "true" : undefined}
						data-inbox-read-state={unread ? "unread" : "read"}
						itemId={item.id}
					>
						<div className={cn(trailingActions && densityStyles.layout)}>
							<InboxItemSourceLink
								className={cn(
									"flex min-w-0 items-start gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
									input.density !== "default"
										? "min-h-16 px-3 py-3 pe-14"
										: "min-h-20 px-4 py-4 pe-16 sm:gap-4",
									inlineInvitation && "min-h-0 gap-4 pb-1",
									{ "pe-3": trailingActions }
								)}
								href={sourceNavigation.href}
								informational={informational}
								onAuxClick={handleAuxClick}
								onClick={handleOpen}
								openInNewTab={sourceNavigation.openInNewTab}
								ref={(element) => {
									input.registerItemElement?.(item.id, element);
								}}
							>
								<span
									aria-hidden="true"
									className="mt-2 flex w-2 shrink-0 justify-center"
								>
									<InboxItemStatusDot dot={input.feedRow?.dot} item={item} />
								</span>
								<InboxLeadingAvatar
									compact={input.density !== "default"}
									inlineInvitation={inlineInvitation}
									item={item}
								/>

								<span className="min-w-0 flex-1">
									<span className="flex min-w-0 flex-wrap items-center gap-2">
										<span
											className={cn(
												"relative line-clamp-2 min-w-0 break-words text-foreground text-sm leading-5",
												unread ? "font-semibold" : "font-medium"
											)}
										>
											{input.titleOverride ?? item.title}
										</span>
										{unread ? <span className="sr-only">Unread.</span> : null}
										<InboxItemBadges item={item} />
										{inlineInvitation ? (
											<span className="text-muted-foreground text-xs">
												<InboxTimestamp occurredAt={item.occurredAt} />
											</span>
										) : null}
									</span>
									<span
										className={cn(
											"mt-1 line-clamp-2 break-words text-muted-foreground text-sm leading-5",
											inlineInvitation && "hidden",
											densityStyles.preview
										)}
									>
										{input.previewOverride ?? item.preview}
									</span>
									<span
										className={cn(
											"flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs",
											densityStyles.metadata,
											inlineInvitation && "hidden"
										)}
									>
										<InboxRowMetadata feedRow={input.feedRow} item={item} />
									</span>
								</span>
							</InboxItemSourceLink>

							<InboxInlineInvitation
								enabled={inlineInvitation}
								item={item}
								onInteract={handleOpen}
							/>
							{trailingActions ? (
								<div className={cn("flex justify-end", densityStyles.actions)}>
									{trailingActions}
								</div>
							) : null}
							{input.children}
						</div>
					</SharedLayoutItem>
				}
			>
				{menu}
			</FluidContextMenu>
		</li>
	);
}

function isInlineInvitation(
	density: InboxItemRowProps["density"],
	item: InboxItem
) {
	return (
		density === "default" &&
		item.sourceTarget.kind === "organization_join_request" &&
		item.resolutionStatus === "open"
	);
}

function InboxInlineInvitation({
	enabled,
	item,
	onInteract,
}: {
	enabled: boolean;
	item: InboxItem;
	onInteract: () => void;
}) {
	if (!enabled || item.sourceTarget.kind !== "organization_join_request") {
		return null;
	}
	return (
		<div className="ps-[4.125rem] pe-4 pb-4">
			<InvitationReview
				inline
				onInteract={onInteract}
				requestId={item.sourceTarget.requestId}
			/>
		</div>
	);
}

function resolveRowIndicator(
	item: InboxItem,
	dot?: InboxFeedRow["dot"]
): ReturnType<typeof resolveInboxItemIndicator> {
	if (
		item.attention === "action_required" &&
		item.resolutionStatus === "open"
	) {
		return "warning";
	}
	if (dot === undefined) {
		return resolveInboxItemIndicator(item);
	}
	if (dot === "yellow") {
		return "warning";
	}
	return dot === "blue" ? "unread" : null;
}

function InboxItemStatusDot({
	item,
	dot,
}: {
	item: InboxItem;
	dot?: InboxFeedRow["dot"];
}) {
	const indicator = resolveRowIndicator(item, dot);
	if (!indicator) {
		return null;
	}
	return (
		<span
			aria-hidden="true"
			className={cn(
				"status-dot shrink-0",
				resolveInboxIndicatorClassName(
					indicator === "unread" ? null : indicator
				)
			)}
			data-inbox-status-dot={indicator}
		/>
	);
}

function InboxItemSourceLink(input: {
	informational?: boolean;
	children: ReactNode;
	className: string;
	href: string;
	onAuxClick: (event: MouseEvent<HTMLAnchorElement>) => void;
	onClick: () => void;
	openInNewTab: boolean;
	ref: (element: HTMLElement | null) => void;
}) {
	const navigate = useNavigate();
	if (input.informational) {
		return (
			<button
				className={cn(input.className, "w-full text-left")}
				onClick={input.onClick}
				ref={input.ref}
				type="button"
			>
				{input.children}
			</button>
		);
	}
	const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
		input.onClick();
		if (
			input.openInNewTab ||
			event.defaultPrevented ||
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
			// Opening an Inbox detail keeps the user's view and filters.
			to: keepInboxFilters({
				currentPathname: window.location.pathname,
				currentSearch: window.location.search,
				href: input.href,
			}),
			state: requestInboxSourceFocus,
		}).catch((error: unknown) =>
			console.warn("[openmeld.web.inbox_navigation_failed]", { error })
		);
	};
	if (input.openInNewTab) {
		return (
			<a
				className={input.className}
				href={input.href}
				onAuxClick={input.onAuxClick}
				onClick={handleClick}
				ref={input.ref}
				rel="noopener noreferrer"
				target="_blank"
			>
				{input.children}
			</a>
		);
	}
	return (
		<Link
			className={input.className}
			onAuxClick={input.onAuxClick}
			onClick={handleClick}
			ref={input.ref}
			to={input.href}
		>
			{input.children}
		</Link>
	);
}

function InboxItemActions(input: {
	menu: ReactNode;
	title: string;
	unread: boolean;
	onRead: () => void;
}) {
	return (
		<div className="flex shrink-0 items-center gap-1">
			<Button
				aria-label={
					input.unread ? `Mark ${input.title} as read` : `${input.title}: Read`
				}
				className="gap-1.5 px-2 text-muted-foreground"
				disabled={!input.unread}
				onClick={input.onRead}
				size="sm"
				variant="ghost"
			>
				<CheckIcon aria-hidden="true" />
				<span>{input.unread ? "Mark as read" : "Read"}</span>
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={`Actions for ${input.title}`}
							size="icon-sm"
							variant="ghost"
						/>
					}
				>
					<DotsThreeIcon aria-hidden="true" weight="bold" />
				</DropdownMenuTrigger>
				<FluidDropdownMenuContent align="end">
					{input.menu}
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function InboxItemMenuItems(input: {
	item: InboxItem;
	onDismiss?: (item: InboxItem) => void;
	onSetRead: (item: InboxItem, read: boolean) => void;
	unread: boolean;
}) {
	return (
		<>
			{" "}
			<FluidDropdownMenuItem
				index={0}
				onClick={() => input.onSetRead(input.item, input.unread)}
			>
				<CheckCircleIcon aria-hidden="true" />
				{input.unread ? "Mark as read" : "Mark as unread"}
			</FluidDropdownMenuItem>
			{input.onDismiss ? (
				<FluidDropdownMenuItem
					index={1}
					onClick={() => input.onDismiss?.(input.item)}
				>
					<XIcon aria-hidden="true" />
					Remove from Inbox
				</FluidDropdownMenuItem>
			) : null}
		</>
	);
}

function InboxKindIcon(input: { item: InboxItem }): ReactNode {
	switch (input.item.kind) {
		case "space_message":
		case "space_joined":
		case "space_mention":
			return <ChatCircleTextIcon aria-hidden="true" className="size-4" />;
		case "agent_reply":
		case "agent_interaction":
		case "agent_access_request":
		case "agent_space_request":
		case "center_agent_update":
			return <RobotIcon aria-hidden="true" className="size-4" />;
		case "document_review":
			return <FileTextIcon aria-hidden="true" className="size-4" />;
		case "organization_request":
			return <ChatCircleTextIcon aria-hidden="true" className="size-4" />;
		case "wake_outcome":
			return input.item.importance === "urgent" ? (
				<WarningCircleIcon aria-hidden="true" className="size-4" />
			) : (
				<CheckCircleIcon aria-hidden="true" className="size-4" />
			);
		case "system_issue":
		case "computer_connection":
		case "credential_confirmation":
			return <WarningCircleIcon aria-hidden="true" className="size-4" />;
		case "desktop_update":
			return <CheckCircleIcon aria-hidden="true" className="size-4" />;
		default:
			return assertNever(input.item.kind);
	}
}

function InboxRowMetadata({
	item,
	feedRow,
}: {
	item: InboxItem;
	feedRow?: InboxFeedRow;
}) {
	return (
		<>
			{item.contextLabel ? (
				<>
					<span className="min-w-0 truncate">{item.contextLabel}</span>
					<span aria-hidden="true">·</span>
				</>
			) : null}
			<InboxTimestamp
				occurredAt={feedRow?.latestOccurredAt ?? item.occurredAt}
			/>
			{feedRow && feedRow.itemCount > 1 ? (
				<>
					<span aria-hidden="true">·</span>
					<span className="tabular-nums">
						{feedRow.unreadCount > 0
							? `${feedRow.unreadCount} unread`
							: `${feedRow.itemCount} activities`}
					</span>
				</>
			) : null}
		</>
	);
}

export function InboxTimestamp(input: { occurredAt: string }) {
	const date = new Date(input.occurredAt);
	return (
		<TooltipHint content={INBOX_TIMESTAMP_TITLE_FORMATTER.format(date)}>
			<time dateTime={date.toISOString()}>
				{formatInboxTimestamp(input.occurredAt)}
			</time>
		</TooltipHint>
	);
}

function formatInboxTimestamp(occurredAt: string): string {
	const occurredAtMs = new Date(occurredAt).getTime();
	const elapsedMs = Math.max(0, Date.now() - occurredAtMs);
	const minutes = Math.floor(elapsedMs / 60_000);
	if (minutes < 1) {
		return "Just now";
	}
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h`;
	}
	const days = Math.floor(hours / 24);
	if (days < 7) {
		return `${days}d`;
	}
	return INBOX_SHORT_DATE_FORMATTER.format(new Date(occurredAtMs));
}

function assertNever(value: never): never {
	throw new Error(`Unsupported Inbox item kind: ${String(value)}`);
}
function InboxItemBadges({ item }: { item: InboxItem }) {
	if (item.attention !== "action_required") {
		return null;
	}
	const pendingLabel = isInboxReview(item)
		? "Awaiting review"
		: "Awaiting your action";
	const label = item.resolutionStatus === "open" ? pendingLabel : "Ended";
	return <span className="text-muted-foreground text-xs">{label}</span>;
}
