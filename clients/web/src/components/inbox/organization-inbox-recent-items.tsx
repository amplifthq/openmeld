"use client";

import { Button } from "@openmeld/ui/components/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { StaleDataNotice } from "#/components/stale-data-notice";
import { buildOrganizationInboxPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { inboxItemsInfiniteQueryOptions } from "#/query/organizations/inbox";
import { InboxItemsList } from "./inbox-list";
import { InboxListSkeleton } from "./inbox-page-presentation";
import { useInboxItemReadMutation } from "./use-inbox-item-read-mutation";

/** Desk's bounded recent-items widget, including read history. */
export function OrganizationInboxRecentItems(input: {
	currentOrganization: OrganizationSummary;
}) {
	const query = useInfiniteQuery(
		inboxItemsInfiniteQueryOptions({
			organizationId: input.currentOrganization.id,
			view: "all",
		})
	);
	const { setRead } = useInboxItemReadMutation({
		organizationId: input.currentOrganization.id,
	});
	if (query.isPending) {
		return <InboxListSkeleton />;
	}
	if (query.isError && !query.data) {
		return (
			<div className="px-4 py-6 text-center" role="alert">
				<p className="text-muted-foreground text-sm">
					Couldn’t load your Inbox.
				</p>
				<Button onClick={() => query.refetch()} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	const items =
		query.data?.pages.flatMap((page) => page.items).slice(0, 6) ?? [];
	return (
		<div className="space-y-3">
			{query.isError ? (
				<StaleDataNotice
					label="Inbox may be out of date."
					onRetry={() => query.refetch()}
				/>
			) : null}
			{items.length ? (
				<section aria-label="Recent updates">
					<h3 className="px-2 pb-1 font-medium text-muted-foreground text-xs">
						Recent updates
					</h3>
					<InboxItemsList
						ariaLabel="Recent Inbox items"
						density="compact"
						items={items}
						onOpenItem={(item) => setRead(item, true)}
						onSetRead={setRead}
						organizationSlug={input.currentOrganization.slug}
						showItemActions={false}
					/>
				</section>
			) : (
				<p className="px-4 py-6 text-center text-muted-foreground text-sm">
					No updates yet
				</p>
			)}
			<Link
				className="inline-block px-2 text-xs underline underline-offset-4"
				to={buildOrganizationInboxPath(input.currentOrganization.slug)}
			>
				Open full Inbox
			</Link>
		</div>
	);
}
