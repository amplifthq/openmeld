"use client";

import type { InboxItem } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { resolveStatusToneAdvisoryBadgeClassName } from "@openmeld/ui/lib/status-tone";
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
import { Link } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import { buildInboxItemSourceNavigation } from "#/lib/inbox/source-target";

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

function InboxItemRow(input: {
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
	const unread = input.item.readAt === null;
	const needsAction =
		input.item.attention === "action_required" &&
		input.item.resolutionStatus === "open";
	const showUrgent =
		input.item.importance === "urgent" &&
		(input.item.attention !== "action_required" ||
			input.item.resolutionStatus === "open");
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
					"group/inbox-row transition-colors motion-reduce:transition-none",
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
							: "min-h-20 px-4 py-4 pe-16 sm:gap-4"
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
						className={cn(
							"relative grid shrink-0 place-items-center rounded-md border border-border/70 bg-background text-muted-foreground",
							input.density === "compact" ? "size-8" : "size-9"
						)}
					>
						<InboxKindIcon item={input.item} />
					</span>

					<span className="min-w-0 flex-1">
						<span className="flex min-w-0 flex-wrap items-center gap-2">
							<span
								className={cn(
									"min-w-0 break-words text-foreground text-sm leading-5",
									unread ? "font-semibold" : "font-medium"
								)}
							>
								{input.item.title}
							</span>
							{unread ? <span className="sr-only">Unread.</span> : null}
							{needsAction && input.item.importance !== "urgent" ? (
								<Badge
									className={resolveStatusToneAdvisoryBadgeClassName()}
									variant="outline"
								>
									Needs action
								</Badge>
							) : null}
							{showUrgent ? (
								<Badge
									className={resolveStatusToneAdvisoryBadgeClassName()}
									variant="outline"
								>
									Urgent
								</Badge>
							) : null}
						</span>
						<span className="mt-1 block break-words text-muted-foreground text-sm leading-5">
							{input.item.preview}
						</span>
						<span
							className={cn(
								"flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs",
								input.density === "compact" ? "mt-1" : "mt-2"
							)}
						>
							{input.item.contextLabel ? (
								<span className="min-w-0 truncate">
									{input.item.contextLabel}
								</span>
							) : null}
							{input.item.contextLabel ? (
								<span aria-hidden="true">·</span>
							) : null}
							<InboxTimestamp occurredAt={input.item.occurredAt} />
						</span>
					</span>
				</InboxItemSourceLink>

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

function InboxItemSourceLink(input: {
	children: ReactNode;
	className: string;
	href: string;
	onAuxClick: (event: MouseEvent<HTMLAnchorElement>) => void;
	onClick: () => void;
	openInNewTab: boolean;
	ref: (element: HTMLAnchorElement | null) => void;
}) {
	if (input.openInNewTab) {
		return (
			<a
				className={input.className}
				href={input.href}
				onAuxClick={input.onAuxClick}
				onClick={input.onClick}
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
			onClick={input.onClick}
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
							variant="ghost"
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
							Dismiss
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
			return <WarningCircleIcon aria-hidden="true" className="size-4" />;
		default:
			return assertNever(input.item.kind);
	}
}

function InboxTimestamp(input: { occurredAt: string }) {
	const date = new Date(input.occurredAt);
	return (
		<time
			dateTime={date.toISOString()}
			title={INBOX_TIMESTAMP_TITLE_FORMATTER.format(date)}
		>
			{formatInboxTimestamp(input.occurredAt)}
		</time>
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
