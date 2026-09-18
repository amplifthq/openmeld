"use client";

import type {
	InboxFeedCategory,
	InboxFeedCounts,
	InboxItem,
	MutateInboxFeedBody,
} from "@openmeld/schemas/types";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
import { Button } from "@openmeld/ui/components/button";
import { Switch } from "@openmeld/ui/components/switch";
import {
	TabsSubtle,
	TabsSubtleItem,
	TabsSubtlePanel,
} from "@openmeld/ui/fluid/tabs-subtle";
import { RobotIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { inboxItemQueryOptions } from "#/query/organizations/inbox";
import {
	useMutateOrganizationInboxFeed,
	useOrganizationInboxFeed,
} from "#/query/organizations/inbox-feed";
import {
	InboxFeedView,
	resolveInboxFeedLoadMoreState,
} from "./inbox-feed-view";
import { InboxItemsList } from "./inbox-list";
import {
	InboxEmptyState,
	InboxInfiniteScrollTrigger,
	InboxInitialError,
	InboxItemLookupWarning,
	InboxListSkeleton,
	InboxRefreshWarning,
} from "./inbox-page-presentation";
import { INBOX_TABS } from "./inbox-page-tabs";
import { InvitationReview } from "./invitation-review";
import { useInboxItemDismissMutation } from "./use-inbox-item-dismiss-mutation";
import { useInboxItemReadMutation } from "./use-inbox-item-read-mutation";

export function InboxPage(input: {
	itemId?: string;
	requestId?: string;
	onItemDismissed?: (itemId: string) => void;
	onViewChange: (view: InboxFeedCategory) => void;
	onUnreadOnlyChange?: (unreadOnly: boolean) => void;
	onAgentsOnlyChange?: (agentsOnly: boolean) => void;
	unreadOnly?: boolean;
	agentsOnly?: boolean;
	view: InboxFeedCategory;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const filters = {
		category: input.view,
		unreadOnly: input.unreadOnly ?? false,
		agentsOnly: input.agentsOnly ?? false,
	};
	const feed = useOrganizationInboxFeed({
		...filters,
		accountId: currentUserId,
		organizationId: currentOrganization.id,
	});
	const deepLink = useQuery(
		inboxItemQueryOptions({
			organizationId: currentOrganization.id,
			itemId: input.itemId ?? "",
			enabled: Boolean(input.itemId),
		})
	);
	const [announcement, setAnnouncement] = useState("");
	const [confirmation, setConfirmation] = useState<{
		snapshotId: string;
	} | null>(null);
	const { setRead } = useInboxItemReadMutation({
		organizationId: currentOrganization.id,
		onAnnouncement: setAnnouncement,
	});
	const { dismiss } = useInboxItemDismissMutation({
		organizationId: currentOrganization.id,
		onAnnouncement: setAnnouncement,
		onDismissed: input.onItemDismissed,
	});
	const selection = useMutateOrganizationInboxFeed(currentOrganization.id);
	const mutateSelection = (body: MutateInboxFeedBody) =>
		selection.mutate(body, {
			onSuccess: (response) =>
				setAnnouncement(
					`${response.changedCount} updates ${body.operation === "read" ? "marked as read" : "dismissed"}. Pending requests remain open.`
				),
			onError: () =>
				toast.error(
					"This selection could not be updated. Refresh your Inbox and try again."
				),
		});
	const sourceItem = deepLink.data?.item;
	const itemElement = useRef<HTMLAnchorElement | null>(null);
	const appliedItem = useRef<string | null>(null);
	const registerItem = useCallback(
		(_id: string, element: HTMLAnchorElement | null) => {
			itemElement.current = element;
		},
		[]
	);
	useEffect(() => {
		const key = sourceItem
			? `${currentUserId}:${currentOrganization.id}:${sourceItem.id}`
			: null;
		if (
			!(sourceItem && itemElement.current && key) ||
			appliedItem.current === key
		) {
			return;
		}
		appliedItem.current = key;
		itemElement.current.focus({ preventScroll: true });
		itemElement.current.scrollIntoView?.({
			behavior: "auto",
			block: "nearest",
		});
		setRead(sourceItem, true);
		setAnnouncement(`Opened ${sourceItem.title}.`);
	}, [sourceItem, currentUserId, currentOrganization.id, setRead]);
	const rows = useMemo(() => {
		const seen = new Set<string>();
		return (feed.data?.pages.flatMap((page) => page.rows) ?? []).filter(
			(row) => {
				if (seen.has(row.groupKey)) {
					return false;
				}
				seen.add(row.groupKey);
				return (
					(row.itemCount > 1 || row.item.id !== sourceItem?.id) &&
					!(
						input.requestId &&
						row.item.sourceTarget.kind === "organization_join_request" &&
						row.item.sourceTarget.requestId === input.requestId
					)
				);
			}
		);
	}, [feed.data, sourceItem?.id, input.requestId]);
	const firstPage = feed.data?.pages[0];
	const selectedIndex = Math.max(
		0,
		INBOX_TABS.findIndex((tab) => tab.view === input.view)
	);
	const loadMoreState = resolveInboxFeedLoadMoreState(feed);
	const openItem = (item: InboxItem) => setRead(item, true);
	return (
		<div className="flex min-w-0 flex-col gap-6">
			<AppPageHeader
				description="Your conversations, decisions, and updates in one place."
				eyebrow={
					currentOrganization.isPersonal
						? "Personal workspace"
						: currentOrganization.name
				}
				id="inbox-heading"
				title="Inbox"
			/>
			<div className="flex min-w-0 flex-col gap-4">
				<div className="flex min-w-0 flex-col gap-3">
					<TabsSubtle
						className="w-fit max-w-full"
						idPrefix="inbox-view"
						onSelect={(index) => {
							const tab = INBOX_TABS[index];
							if (tab && tab.view !== input.view) {
								input.onViewChange(tab.view);
							}
						}}
						selectedIndex={selectedIndex}
					>
						{INBOX_TABS.map((tab, index) => (
							<TabsSubtleItem index={index} key={tab.view} label={tab.label} />
						))}
					</TabsSubtle>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex flex-wrap items-center gap-4">
							<label
								className="flex cursor-pointer items-center gap-2 text-muted-foreground text-sm"
								htmlFor="inbox-unread-only"
							>
								<Switch
									aria-label="Unread only"
									checked={filters.unreadOnly}
									id="inbox-unread-only"
									onCheckedChange={(value) => input.onUnreadOnlyChange?.(value)}
								/>
								Unread only
							</label>
							<Button
								aria-pressed={filters.agentsOnly}
								className="gap-2"
								onClick={() => input.onAgentsOnlyChange?.(!filters.agentsOnly)}
								size="sm"
								variant={filters.agentsOnly ? "secondary" : "outline"}
							>
								<RobotIcon aria-hidden="true" className="size-4" />
								Agents
							</Button>
						</div>
						<div className="flex flex-wrap items-center gap-3">
							{firstPage ? (
								<span
									className="text-muted-foreground text-xs tabular-nums"
									title="Matching Inbox items"
								>
									{countForCategory(firstPage.counts, input.view)} items
								</span>
							) : null}
							{firstPage && firstPage.counts.unread > 0 ? (
								<Button
									disabled={selection.isPending}
									onClick={() =>
										setConfirmation({ snapshotId: firstPage.snapshotId })
									}
									size="sm"
									variant="ghost"
								>
									Mark this view as read
								</Button>
							) : null}
						</div>
					</div>
				</div>
				{input.requestId ? (
					<section
						aria-label="Invitation request"
						className="rounded-md border border-border/70 p-4"
					>
						<InvitationReview requestId={input.requestId} />
						<Link
							className="mt-3 inline-block text-muted-foreground text-xs hover:underline"
							params={{ orgSlug: currentOrganization.slug }}
							search={{ view: "needs-review" }}
							to="/o/$orgSlug/inbox"
						>
							Back to reviews
						</Link>
					</section>
				) : null}
				{sourceItem ? (
					<section aria-label="Selected update" className="min-w-0">
						<h2 className="mb-2 text-muted-foreground text-xs">
							Selected update
						</h2>
						<InboxItemsList
							focusedItemId={sourceItem.id}
							items={[sourceItem]}
							onDismiss={dismiss}
							onOpenItem={openItem}
							onSetRead={setRead}
							organizationSlug={currentOrganization.slug}
							registerItemElement={registerItem}
						/>
					</section>
				) : null}
				{input.itemId && deepLink.isPending ? <InboxListSkeleton /> : null}
				{deepLink.error?.status === 404 ? (
					<output className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
						This Inbox item isn’t available. It may have been removed or you may
						no longer have access.
					</output>
				) : null}
				{deepLink.isError && deepLink.error.status !== 404 ? (
					<InboxItemLookupWarning onRetry={() => deepLink.refetch()} />
				) : null}
				{feed.isRefetchError && feed.data && !feed.isFetchNextPageError ? (
					<InboxRefreshWarning onRetry={() => feed.refetch()} />
				) : null}
				{INBOX_TABS.map((tab, index) => (
					<TabsSubtlePanel
						idPrefix="inbox-view"
						index={index}
						key={tab.view}
						selectedIndex={selectedIndex}
					>
						{index === selectedIndex ? (
							<div className="flex min-w-0 flex-col gap-4">
								{feed.isPending ? <InboxListSkeleton /> : null}
								{feed.isError && !feed.data ? (
									<InboxInitialError onRetry={() => feed.refetch()} />
								) : null}
								{firstPage && rows.length > 0 ? (
									<InboxFeedView
										accountId={currentUserId}
										filters={filters}
										isMutating={selection.isPending}
										onDismiss={dismiss}
										onOpenItem={openItem}
										onSelection={mutateSelection}
										onSetRead={setRead}
										organizationId={currentOrganization.id}
										organizationSlug={currentOrganization.slug}
										rows={rows}
										snapshotId={firstPage.snapshotId}
									/>
								) : null}
								{firstPage &&
								rows.length === 0 &&
								!sourceItem &&
								!feed.hasNextPage ? (
									<InboxEmptyState
										unreadOnly={filters.unreadOnly}
										view={input.view}
									/>
								) : null}
								{loadMoreState ? (
									<InboxInfiniteScrollTrigger
										onLoadMore={() => feed.fetchNextPage()}
										state={loadMoreState}
									/>
								) : null}
							</div>
						) : null}
					</TabsSubtlePanel>
				))}
			</div>
			<AlertDialog
				onOpenChange={(open) => {
					if (!open) {
						setConfirmation(null);
					}
				}}
				open={confirmation !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Mark this view as read?</AlertDialogTitle>
						<AlertDialogDescription>
							Mark unread updates in this filtered selection as read, including
							its other pages. New messages and items outside this selection
							stay unread. Pending requests stay open.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<Button
							disabled={selection.isPending}
							onClick={() => {
								if (confirmation) {
									mutateSelection({
										snapshotId: confirmation.snapshotId,
										operation: "read",
									});
								}
								setConfirmation(null);
							}}
						>
							Mark this view as read
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<div aria-atomic="true" aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</div>
	);
}

function countForCategory(
	counts: InboxFeedCounts,
	category: InboxFeedCategory
): number {
	if (category === "needs_action") {
		return counts.needsAction;
	}
	if (category === "needs_review") {
		return counts.needsReview;
	}
	return counts[category];
}

/** Exact deep links stay accessible even outside the selected category/page. */
export function mergeDeepLinkedInboxItem(
	items: readonly InboxItem[],
	item: InboxItem | undefined
): InboxItem[] {
	return item
		? [item, ...items.filter((candidate) => candidate.id !== item.id)]
		: [...items];
}
