"use client";

import type {
	InboxFeedRow,
	InboxItem,
	MutateInboxFeedBody,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { SharedLayoutGroup } from "@openmeld/ui/fluid/shared-layout-group";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import {
	type InboxFeedFilters,
	useOrganizationInboxFeed,
} from "#/query/organizations/inbox-feed";
import { InboxItemRow, InboxItemsList } from "./inbox-list";
import {
	InboxInfiniteScrollTrigger,
	InboxListSkeleton,
	InboxRefreshWarning,
} from "./inbox-page-presentation";

type FeedViewProps = {
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

const SECTION_LABELS: Record<InboxFeedRow["section"], string> = {
	priority: "Priority attention",
	open: "Waiting for you",
	activity: "Activity and history",
};

export function InboxFeedView(input: FeedViewProps) {
	const sections = new Map<InboxFeedRow["section"], InboxFeedRow[]>();
	for (const row of input.rows) {
		const rows = sections.get(row.section) ?? [];
		rows.push(row);
		sections.set(row.section, rows);
	}
	return (
		<div className="flex min-w-0 flex-col gap-5">
			{[...sections].map(([section, rows]) => (
				<section
					aria-label={SECTION_LABELS[section]}
					className="min-w-0"
					key={section}
				>
					<h2 className="mb-2 px-1 font-medium text-muted-foreground text-xs">
						{SECTION_LABELS[section]}
					</h2>
					<SharedLayoutGroup>
						<ul
							aria-label={SECTION_LABELS[section]}
							className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70 bg-card"
						>
							{rows.map((row) => (
								<InboxFeedGroup {...input} key={row.groupKey} row={row} />
							))}
						</ul>
					</SharedLayoutGroup>
				</section>
			))}
		</div>
	);
}

function InboxFeedGroup(input: FeedViewProps & { row: InboxFeedRow }) {
	const [expanded, setExpanded] = useState(false);
	const panelId = useId();
	return (
		<InboxItemRow
			density="default"
			feedRow={input.row}
			focused={false}
			item={input.row.item}
			onDismiss={input.row.itemCount === 1 ? input.onDismiss : undefined}
			onOpenItem={input.onOpenItem}
			onSetRead={input.onSetRead}
			organizationSlug={input.organizationSlug}
			showItemActions={input.row.itemCount === 1}
		>
			{input.row.itemCount > 1 ? (
				<div className="px-4 ps-[4.5rem] pb-3 sm:ps-20">
					<div className="flex flex-wrap items-center gap-2">
						<Button
							aria-controls={panelId}
							aria-expanded={expanded}
							className="h-7 px-2 text-xs"
							onClick={() => setExpanded(!expanded)}
							size="sm"
							variant="ghost"
						>
							{expanded ? (
								<CaretUpIcon aria-hidden="true" />
							) : (
								<CaretDownIcon aria-hidden="true" />
							)}
							{expanded
								? "Hide updates"
								: `View ${input.row.itemCount} updates`}
						</Button>
						{input.row.unreadCount > 0 ? (
							<Button
								className="h-7 px-2 text-xs"
								disabled={input.isMutating}
								onClick={() =>
									input.onSelection({
										snapshotId: input.snapshotId,
										groupKey: input.row.groupKey,
										operation: "read",
									})
								}
								size="sm"
								variant="ghost"
							>
								Mark these as read
							</Button>
						) : null}
						<Button
							className="h-7 px-2 text-muted-foreground text-xs"
							disabled={input.isMutating}
							onClick={() =>
								input.onSelection({
									snapshotId: input.snapshotId,
									groupKey: input.row.groupKey,
									operation: "dismiss",
								})
							}
							size="sm"
							variant="ghost"
						>
							Dismiss these updates
						</Button>
					</div>
					{expanded ? (
						<ExpandedInboxGroup {...input} panelId={panelId} />
					) : null}
				</div>
			) : null}
		</InboxItemRow>
	);
}

function ExpandedInboxGroup(
	input: FeedViewProps & { row: InboxFeedRow; panelId: string }
) {
	const members = useOrganizationInboxFeed({
		...input.filters,
		accountId: input.accountId,
		organizationId: input.organizationId,
		snapshotId: input.snapshotId,
		groupKey: input.row.groupKey,
	});
	return (
		<section
			aria-label="Conversation updates"
			className="mt-3 flex min-w-0 flex-col gap-3"
			id={input.panelId}
		>
			{members.isPending ? <InboxListSkeleton /> : null}
			{members.isError ? (
				<InboxRefreshWarning onRetry={() => members.refetch()} />
			) : null}
			{members.data ? (
				<InboxItemsList
					ariaLabel="Conversation updates"
					density="compact"
					items={members.data.pages.flatMap((page) =>
						page.rows.map((row) => row.item)
					)}
					onDismiss={input.onDismiss}
					onOpenItem={input.onOpenItem}
					onSetRead={input.onSetRead}
					organizationSlug={input.organizationSlug}
				/>
			) : null}
			{members.hasNextPage || members.isFetchNextPageError ? (
				<InboxInfiniteScrollTrigger
					onLoadMore={() => members.fetchNextPage()}
					state={resolveInboxFeedLoadMoreState(members) ?? "idle"}
				/>
			) : null}
		</section>
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
