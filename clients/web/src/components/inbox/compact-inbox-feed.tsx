"use client";

import type { MutateInboxFeedBody } from "@openmeld/schemas/types";
import { TrayIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	useMutateOrganizationInboxFeed,
	useOrganizationInboxFeed,
} from "#/query/organizations/inbox-feed";
import {
	InboxFeedView,
	resolveInboxFeedLoadMoreState,
} from "./inbox-feed-view";
import {
	InboxInfiniteScrollTrigger,
	InboxInitialError,
	InboxListSkeleton,
	InboxRefreshWarning,
} from "./inbox-page-presentation";
import { useInboxExpansion } from "./use-inbox-expansion";
import { useInboxItemReadMutation } from "./use-inbox-item-read-mutation";

const FILTERS = {
	category: "all",
	grouping: "space",
	unreadOnly: false,
	agentsOnly: false,
} as const;

/** The canonical Inbox feed in the toolbar, with the same source and read rules. */
export function CompactInboxFeed(input: { onOpenItem: () => void }) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const expansion = useInboxExpansion(currentUserId, currentOrganization.id);
	const [announcement, setAnnouncement] = useState("");
	const feed = useOrganizationInboxFeed({
		...FILTERS,
		accountId: currentUserId,
		organizationId: currentOrganization.id,
		limit: 12,
	});
	const { setRead } = useInboxItemReadMutation({
		organizationId: currentOrganization.id,
		onAnnouncement: setAnnouncement,
	});
	const selection = useMutateOrganizationInboxFeed(currentOrganization.id);
	const firstPage = feed.data?.pages[0];
	const snapshotExpired = firstPage
		? Date.parse(firstPage.snapshotExpiresAt) <= Date.now()
		: false;
	const seen = new Set<string>();
	const rows = (feed.data?.pages.flatMap((page) => page.rows) ?? []).filter(
		(row) => {
			if (seen.has(row.groupKey)) {
				return false;
			}
			seen.add(row.groupKey);
			return true;
		}
	);
	const loadMoreState = resolveInboxFeedLoadMoreState(feed, snapshotExpired);
	const refreshWarningShown =
		(feed.isRefetchError && !feed.isFetchNextPageError) || snapshotExpired;
	const markSelectionRead = (body: MutateInboxFeedBody) => {
		selection.mutate(body, {
			onSuccess: (response) =>
				setAnnouncement(
					`${response.changedCount} ${response.changedCount === 1 ? "item" : "items"} marked as read. Pending requests remain open.`
				),
			onError: () =>
				toast.error(
					"Couldn’t mark these items as read. Refresh your Inbox and try again."
				),
		});
	};
	if (feed.isPending) {
		return <InboxListSkeleton />;
	}
	if (feed.isError && !feed.data) {
		return <InboxInitialError onRetry={() => feed.refetch()} />;
	}
	return (
		<div className="min-w-0 space-y-3">
			<span aria-live="polite" className="sr-only">
				{announcement}
			</span>
			{refreshWarningShown ? (
				<InboxRefreshWarning onRetry={() => feed.refetch()} />
			) : null}
			{firstPage && rows.length > 0 ? (
				<InboxFeedView
					accountId={currentUserId}
					compact
					expansion={expansion}
					filters={FILTERS}
					isMutating={selection.isPending || snapshotExpired}
					onOpenItem={(item) => {
						setRead(item, true);
						input.onOpenItem();
					}}
					onSelection={markSelectionRead}
					onSetRead={setRead}
					organizationId={currentOrganization.id}
					organizationSlug={currentOrganization.slug}
					refreshWarningShown={refreshWarningShown}
					rows={rows}
					sectionAction={null}
					snapshotId={firstPage.snapshotId}
				/>
			) : null}
			{rows.length === 0 && !feed.hasNextPage ? (
				<div className="flex min-h-48 flex-col items-center justify-center px-4 py-8 text-center">
					<TrayIcon
						aria-hidden="true"
						className="size-5 text-muted-foreground"
					/>
					<p className="mt-3 font-medium text-sm">No updates yet</p>
					<p className="mt-1 text-muted-foreground text-sm">
						New updates and requests will appear here.
					</p>
				</div>
			) : null}
			{loadMoreState ? (
				<InboxInfiniteScrollTrigger
					onLoadMore={() => feed.fetchNextPage()}
					state={loadMoreState}
				/>
			) : null}
		</div>
	);
}
