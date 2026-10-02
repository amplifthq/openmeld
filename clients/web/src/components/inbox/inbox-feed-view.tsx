"use client";

import type {
	InboxFeedRow,
	InboxItem,
	MutateInboxFeedBody,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { SharedLayoutGroup } from "@openmeld/ui/fluid/shared-layout-group";
import {
	BellIcon,
	CaretDownIcon,
	CaretRightIcon,
	CheckIcon,
	DotsThreeIcon,
	FolderIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useId } from "react";
import {
	presentInboxItem,
	useConversationNames,
} from "#/components/spaces/conversation-names";
import {
	type InboxFeedFilters,
	useOrganizationInboxFeed,
} from "#/query/organizations/inbox-feed";
import { useInboxAvatar } from "./inbox-avatars";
import { InboxItemRow, InboxTimestamp } from "./inbox-list";
import {
	InboxListSkeleton,
	InboxRefreshWarning,
} from "./inbox-page-presentation";
import type { useInboxExpansion } from "./use-inbox-expansion";

type FeedViewProps = {
	expansion: ReturnType<typeof useInboxExpansion>;
	sectionAction: ReactNode;
	accountId: string;
	organizationId: string;
	organizationSlug: string;
	filters: InboxFeedFilters;
	snapshotId: string;
	rows: readonly InboxFeedRow[];
	onOpenItem: (item: InboxItem) => void;
	onSetRead: (item: InboxItem, read: boolean) => void;
	onDismiss: (item: InboxItem) => void;
	onSelection: (selection: MutateInboxFeedBody) => void;
	isMutating: boolean;
};

export function InboxFeedView(input: FeedViewProps) {
	const attention = input.rows.filter((row) => row.section !== "activity");
	const updates = input.rows.filter((row) => row.section === "activity");
	return (
		<div className="flex min-w-0 flex-col gap-6">
			{[
				{ label: "Needs your attention", rows: attention },
				{ label: "Updates", rows: updates },
			]
				.filter((section) => section.rows.length)
				.map((section, index) => (
					<section
						aria-label={section.label}
						className="min-w-0"
						key={section.label}
					>
						<div className="mb-2 flex min-h-8 items-center justify-between gap-3">
							<h2 className="font-medium text-muted-foreground text-xs">
								{section.label}
							</h2>
							{index === 0 ? input.sectionAction : null}
						</div>
						<SharedLayoutGroup>
							<ul
								aria-label={section.label}
								className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/70 bg-card"
							>
								{section.rows.map((row) =>
									row.group?.kind === "space" ||
									row.group?.kind === "system" ? (
										<InboxCollection {...input} key={row.groupKey} row={row} />
									) : (
										<InboxFeedItem {...input} key={row.groupKey} row={row} />
									)
								)}
							</ul>
						</SharedLayoutGroup>
					</section>
				))}
		</div>
	);
}

function groupLabel(row: InboxFeedRow) {
	return row.group?.kind === "system"
		? "System updates"
		: (row.item.contextLabel ?? "Conversation");
}

function groupSummary(row: InboxFeedRow) {
	const count =
		row.group?.kind === "system"
			? row.itemCount
			: (row.group?.conversationCount ?? 1);
	const noun = row.group?.kind === "system" ? "update" : "conversation";
	const unread =
		row.unreadCount > 0 ? `${row.unreadCount} unread` : "All caught up";
	return `${count} ${noun}${count === 1 ? "" : "s"} · ${unread}`;
}

function InboxGroupActions(
	input: FeedViewProps & { row: InboxFeedRow; label: string }
) {
	const row = input.row;
	return (
		<div className="flex shrink-0 items-center gap-1">
			<Button
				aria-label={
					row.unreadCount
						? `Mark ${input.label} as read`
						: `${input.label}: Read`
				}
				className="gap-1.5 px-2 text-muted-foreground"
				disabled={input.isMutating || row.unreadCount === 0}
				onClick={() =>
					input.onSelection({
						snapshotId: input.snapshotId,
						groupKey: row.groupKey,
						operation: "read",
					})
				}
				size="sm"
				variant="ghost"
			>
				<CheckIcon aria-hidden="true" />
				<span>{row.unreadCount ? "Mark as read" : "Read"}</span>
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={`More actions for ${input.label}`}
							size="icon-sm"
							variant="ghost"
						/>
					}
				>
					<DotsThreeIcon aria-hidden="true" />
				</DropdownMenuTrigger>
				<FluidDropdownMenuContent align="end">
					<FluidDropdownMenuItem
						disabled={input.isMutating}
						index={0}
						onClick={() =>
							input.onSelection({
								snapshotId: input.snapshotId,
								groupKey: row.groupKey,
								operation: "dismiss",
							})
						}
					>
						Remove from Inbox
					</FluidDropdownMenuItem>
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function InboxCollection(input: FeedViewProps & { row: InboxFeedRow }) {
	const row = {
		...input.row,
		item: presentInboxItem(input.row.item, useConversationNames()),
	};
	const label = groupLabel(row);
	const expanded = input.expansion.isExpanded(row.groupKey);
	const panelId = useId();
	const avatar = useInboxAvatar(row.item);
	const system = row.group?.kind === "system";
	return (
		<li data-inbox-group={system ? "system" : "space"}>
			<div className="flex flex-wrap items-center gap-x-3 px-3 py-3 sm:px-4">
				<button
					aria-controls={panelId}
					aria-expanded={expanded}
					aria-label={`${label} ${groupSummary(row)}`}
					className="flex min-w-0 flex-1 items-center gap-3 rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => input.expansion.toggle(row.groupKey)}
					type="button"
				>
					{expanded ? (
						<CaretDownIcon
							aria-hidden="true"
							className="size-3.5 shrink-0 text-muted-foreground"
						/>
					) : (
						<CaretRightIcon
							aria-hidden="true"
							className="size-3.5 shrink-0 text-muted-foreground"
						/>
					)}
					<span className="grid size-8 shrink-0 place-items-center text-muted-foreground">
						{system ? (
							<BellIcon aria-hidden="true" className="size-5" />
						) : (
							(avatar ?? <FolderIcon aria-hidden="true" className="size-5" />)
						)}
					</span>
					<span className="min-w-0 flex-1">
						<span className="flex items-center gap-2">
							<span className="truncate font-medium text-sm">{label}</span>
							{row.unreadCount > 0 ? (
								<span
									aria-hidden="true"
									className="status-dot shrink-0 bg-unread"
								/>
							) : null}
						</span>{" "}
						<span className="mt-0.5 block text-muted-foreground text-xs">
							{groupSummary(row)}
						</span>
						{expanded ? null : (
							<span className="mt-2 block truncate text-muted-foreground text-sm">
								{row.item.preview}
							</span>
						)}
					</span>
				</button>
				<span className="hidden text-muted-foreground text-xs sm:block">
					<InboxTimestamp occurredAt={row.latestOccurredAt} />
				</span>
				<InboxGroupActions {...input} label={label} />
			</div>
			{expanded ? (
				<InboxCollectionContents {...input} panelId={panelId} />
			) : null}
		</li>
	);
}

function InboxCollectionContents(
	input: FeedViewProps & { row: InboxFeedRow; panelId: string }
) {
	const members = useOrganizationInboxFeed({
		...input.filters,
		accountId: input.accountId,
		organizationId: input.organizationId,
		snapshotId: input.snapshotId,
		groupKey: input.row.groupKey,
		limit: 8,
	});
	const rows = members.data?.pages.flatMap((page) => page.rows) ?? [];
	let moreLabel = "Show more";
	if (members.isFetchNextPageError) {
		moreLabel = "Retry loading";
	}
	if (members.isFetchingNextPage) {
		moreLabel = "Loading…";
	}
	return (
		<div className="border-border/50 border-t" id={input.panelId}>
			{members.isPending ? <InboxListSkeleton /> : null}
			{members.isError ? (
				<InboxRefreshWarning onRetry={() => members.refetch()} />
			) : null}
			<ul
				aria-label={`Updates in ${groupLabel(input.row)}`}
				className="divide-y divide-border/40"
			>
				{rows.map((row) => (
					<InboxFeedItem {...input} key={row.groupKey} row={row} />
				))}
			</ul>
			{members.hasNextPage || members.isFetchNextPageError ? (
				<Button
					className="my-2 ms-4"
					disabled={members.isFetchingNextPage}
					onClick={() => members.fetchNextPage()}
					size="sm"
					variant="ghost"
				>
					{moreLabel}
				</Button>
			) : null}
		</div>
	);
}

function InboxFeedItem(input: FeedViewProps & { row: InboxFeedRow }) {
	const row = {
		...input.row,
		item: presentInboxItem(input.row.item, useConversationNames()),
	};
	const conversation = row.group?.kind === "conversation";
	return (
		<InboxItemRow
			contextActions={
				conversation ? (
					<FluidDropdownMenuItem
						index={0}
						onClick={() =>
							input.onSelection({
								snapshotId: input.snapshotId,
								groupKey: row.groupKey,
								operation: "read",
							})
						}
					>
						Mark conversation as read
					</FluidDropdownMenuItem>
				) : undefined
			}
			density="compact"
			feedRow={row}
			focused={false}
			item={row.item}
			onDismiss={input.onDismiss}
			onOpenItem={input.onOpenItem}
			onSetRead={input.onSetRead}
			organizationSlug={input.organizationSlug}
			previewOverride={conversation ? row.item.title : undefined}
			showItemActions={!conversation}
			titleOverride={conversation ? row.item.preview : undefined}
			trailingActions={
				conversation ? (
					<InboxGroupActions {...input} label={row.item.title} />
				) : undefined
			}
		/>
	);
}

export function resolveInboxFeedLoadMoreState(input: {
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	isFetchNextPageError: boolean;
}): "idle" | "loading" | "error" | undefined {
	if (input.isFetchingNextPage) {
		return "loading";
	}
	if (input.isFetchNextPageError) {
		return "error";
	}
	return input.hasNextPage ? "idle" : undefined;
}
