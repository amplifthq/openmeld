"use client";

import type { InboxFeedRow, InboxItem } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ChatCircleTextIcon,
	CheckCircleIcon,
	DotsThreeIcon,
	FileTextIcon,
	RobotIcon,
	WarningCircleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import {
	resolveInboxIndicatorClassName,
	resolveInboxItemIndicator,
} from "#/lib/inbox/attention";
import { isInboxReview } from "#/lib/inbox/review";
import { requestInboxSourceFocus } from "#/lib/inbox/source-focus-request";
import { buildInboxItemSourceNavigation } from "#/lib/inbox/source-target";
import { InvitationReview } from "./invitation-review";

const INBOX_SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});

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
	registerItemElement?: (
		itemId: string,
		element: HTMLAnchorElement | null
	) => void;
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

export function InboxItemRow(input: {
	feedRow?: InboxFeedRow;
	children?: ReactNode;
	density: "compact" | "default";
	focused: boolean;
	item: InboxItem;
	onDismiss?: (item: InboxItem) => void;
	onOpenItem: (item: InboxItem) => void;
	onSetRead: (item: InboxItem, read: boolean) => void;
	organizationSlug: string;
	registerItemElement?: (
		itemId: string,
		element: HTMLAnchorElement | null
	) => void;
	showItemActions: boolean;
}) {
	const inlineInvitation =
		input.density === "default" &&
		input.item.sourceTarget.kind === "organization_join_request" &&
		input.item.resolutionStatus === "open";
	const unread = input.feedRow
		? input.feedRow.unreadCount > 0
		: input.item.readAt === null;
	const sourceNavigation = buildInboxItemSourceNavigation({
		item: input.item,
		orgSlug: input.organizationSlug,
	});
	const handleOpen = () => {
		input.onOpenItem(input.item);
	};
	const handleAuxClick = (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.button === 1) {
			handleOpen();
		}
	};

	return (
		<li>
			<SharedLayoutItem
				className={cn(
					"group/inbox-row relative transition-colors motion-reduce:transition-none",
					unread && "bg-foreground/[0.025]",
					input.focused && "bg-muted/50"
				)}
				data-inbox-focused={input.focused ? "true" : undefined}
				data-inbox-read-state={unread ? "unread" : "read"}
				itemId={input.item.id}
			>
				<InboxItemSourceLink
					className={cn(
						"flex min-w-0 items-start gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
						input.density === "compact"
							? "min-h-16 px-3 py-3"
							: "min-h-20 px-4 py-4 pe-16 sm:gap-4",
						inlineInvitation && "min-h-0 gap-4 pb-1"
					)}
					href={sourceNavigation.href}
					onAuxClick={handleAuxClick}
					onClick={handleOpen}
					openInNewTab={sourceNavigation.openInNewTab}
					ref={(element) => {
						input.registerItemElement?.(input.item.id, element);
					}}
				>
					<span
						aria-hidden="true"
						className="mt-2 flex w-2 shrink-0 justify-center"
					>
						<InboxItemStatusDot dot={input.feedRow?.dot} item={input.item} />
					</span>
					<span
						className={cn(
							"relative grid shrink-0 place-items-center rounded-md border border-border/70 bg-background text-muted-foreground",
							input.density === "compact" ? "size-8" : "size-9",
							inlineInvitation && "size-5 border-0 bg-transparent"
						)}
					>
						<InboxKindIcon item={input.item} />
					</span>

					<span className="min-w-0 flex-1">
						<span className="flex min-w-0 flex-wrap items-center gap-2">
							<span
								className={cn(
									"relative min-w-0 break-words text-foreground text-sm leading-5",
									unread ? "font-semibold" : "font-medium"
								)}
							>
								{input.item.title}
							</span>
							{unread ? <span className="sr-only">Unread.</span> : null}
							<InboxItemBadges item={input.item} />
							{inlineInvitation ? (
								<span className="text-muted-foreground text-xs">
									<InboxTimestamp occurredAt={input.item.occurredAt} />
								</span>
							) : null}
						</span>
						<span
							className={cn(
								"mt-1 block break-words text-muted-foreground text-sm leading-5",
								inlineInvitation && "hidden"
							)}
						>
							{input.item.preview}
						</span>
						<span
							className={cn(
								"flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs",
								input.density === "compact" ? "mt-1" : "mt-2",
								inlineInvitation && "hidden"
							)}
						>
							<InboxRowMetadata feedRow={input.feedRow} item={input.item} />
						</span>
					</span>
				</InboxItemSourceLink>

				{inlineInvitation &&
				input.item.sourceTarget.kind === "organization_join_request" ? (
					<div className="ps-[4.125rem] pe-4 pb-4">
						<InvitationReview
							inline
							onInteract={handleOpen}
							requestId={input.item.sourceTarget.requestId}
						/>
					</div>
				) : null}
				{input.children}
				{input.showItemActions ? (
					<InboxItemActions
						item={input.item}
						onDismiss={input.onDismiss}
						onSetRead={input.onSetRead}
						unread={unread}
					/>
				) : null}
			</SharedLayoutItem>
		</li>
	);
}

function resolveRowIndicator(
	item: InboxItem,
	dot?: InboxFeedRow["dot"]
): ReturnType<typeof resolveInboxItemIndicator> {
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
	children: ReactNode;
	className: string;
	href: string;
	onAuxClick: (event: MouseEvent<HTMLAnchorElement>) => void;
	onClick: () => void;
	openInNewTab: boolean;
	ref: (element: HTMLAnchorElement | null) => void;
}) {
	const navigate = useNavigate();
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
			to: input.href,
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
	item: InboxItem;
	onDismiss?: (item: InboxItem) => void;
	onSetRead: (item: InboxItem, read: boolean) => void;
	unread: boolean;
}) {
	return (
		<div className="absolute inset-y-0 end-2 z-20 flex items-center">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={`Actions for ${input.item.title}`}
							className="size-10 opacity-100 transition-opacity motion-reduce:transition-none sm:opacity-0 sm:data-popup-open:opacity-100 sm:group-hover/inbox-row:opacity-100 sm:focus-visible:opacity-100"
							size="icon-sm"
							variant="secondary"
						/>
					}
				>
					<DotsThreeIcon aria-hidden="true" weight="bold" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						onClick={() => input.onSetRead(input.item, input.unread)}
					>
						<CheckCircleIcon aria-hidden="true" />
						{input.unread ? "Mark as read" : "Mark as unread"}
					</DropdownMenuItem>
					{input.onDismiss ? (
						<DropdownMenuItem onClick={() => input.onDismiss?.(input.item)}>
							<XIcon aria-hidden="true" />
							Remove from Inbox
						</DropdownMenuItem>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function InboxKindIcon(input: { item: InboxItem }): ReactNode {
	switch (input.item.kind) {
		case "space_message":
		case "space_mention":
			return <ChatCircleTextIcon aria-hidden="true" className="size-4" />;
		case "agent_reply":
		case "agent_interaction":
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
							: `${feedRow.itemCount} updates`}
					</span>
				</>
			) : null}
		</>
	);
}

function InboxTimestamp(input: { occurredAt: string }) {
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
