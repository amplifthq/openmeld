"use client";

import type { InboxItem } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { TrayIcon } from "@phosphor-icons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { StaleDataNotice } from "#/components/stale-data-notice";
import { buildOrganizationInboxPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { inboxItemsInfiniteQueryOptions } from "#/query/organizations/inbox";
import { InboxItemsList } from "./inbox-list";
import { useInboxItemReadMutation } from "./use-inbox-item-read-mutation";

const INBOX_PREVIEW_LIMIT = 6;
const INBOX_PREVIEW_ACTION_LIMIT = 3;
const INBOX_PREVIEW_SKELETON_IDS = ["first", "second", "third"] as const;

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
	return (
		<InboxPreviewContent
			actionItems={[]}
			includesRead
			isError={query.isError && !query.data}
			isLoading={query.isPending}
			isStale={query.isError && !!query.data}
			onOpenItem={(item) => setRead(item, true)}
			onRetry={() => query.refetch()}
			onSetRead={setRead}
			organizationSlug={input.currentOrganization.slug}
			reviewItems={[]}
			updateItems={
				query.data?.pages.flatMap((page) => page.items).slice(0, 6) ?? []
			}
			urgentItems={[]}
		/>
	);
}

export function OrganizationInboxPreview(input: {
	actionLimit?: number;
	currentOrganization: OrganizationSummary;
	enabled?: boolean;
	itemLimit?: number;
	onOpenItem?: () => void;
}) {
	const enabled = input.enabled ?? true;
	const itemLimit = Math.max(0, input.itemLimit ?? INBOX_PREVIEW_LIMIT);
	const actionLimit = Math.max(
		0,
		Math.min(input.actionLimit ?? INBOX_PREVIEW_ACTION_LIMIT, itemLimit)
	);
	const actionsQuery = useInfiniteQuery(
		inboxItemsInfiniteQueryOptions({
			enabled,
			organizationId: input.currentOrganization.id,
			view: "needs_action",
		})
	);
	const reviewsQuery = useInfiniteQuery(
		inboxItemsInfiniteQueryOptions({
			enabled,
			organizationId: input.currentOrganization.id,
			view: "needs_review",
		})
	);
	const unreadQuery = useInfiniteQuery(
		inboxItemsInfiniteQueryOptions({
			enabled,
			organizationId: input.currentOrganization.id,
			view: "recent_updates",
		})
	);
	const urgentQuery = useInfiniteQuery(
		inboxItemsInfiniteQueryOptions({
			enabled,
			organizationId: input.currentOrganization.id,
			view: "urgent_updates",
		})
	);
	const actionItems = (
		actionsQuery.data?.pages.flatMap((page) => page.items) ?? []
	).slice(0, actionLimit);
	const reviewItems = (
		reviewsQuery.data?.pages.flatMap((page) => page.items) ?? []
	).slice(0, Math.min(actionLimit, itemLimit - actionItems.length));
	const urgentItems = (
		urgentQuery.data?.pages.flatMap((page) => page.items) ?? []
	).slice(0, Math.min(2, itemLimit - actionItems.length - reviewItems.length));
	const updateItems = (
		unreadQuery.data?.pages.flatMap((page) => page.items) ?? []
	).slice(
		0,
		itemLimit - actionItems.length - reviewItems.length - urgentItems.length
	);
	const { setRead } = useInboxItemReadMutation({
		organizationId: input.currentOrganization.id,
	});
	const refreshFailed =
		actionsQuery.isError ||
		reviewsQuery.isError ||
		unreadQuery.isError ||
		urgentQuery.isError;
	const dataUnavailable =
		(actionsQuery.isError && !actionsQuery.data) ||
		(reviewsQuery.isError && !reviewsQuery.data) ||
		(unreadQuery.isError && !unreadQuery.data) ||
		(urgentQuery.isError && !urgentQuery.data);

	return (
		<InboxPreviewContent
			actionItems={actionItems}
			isError={dataUnavailable}
			isLoading={
				actionsQuery.isPending ||
				reviewsQuery.isPending ||
				unreadQuery.isPending ||
				urgentQuery.isPending
			}
			isStale={refreshFailed && !dataUnavailable}
			onOpenItem={(item) => {
				setRead(item, true);
				input.onOpenItem?.();
			}}
			onRetry={async () =>
				await Promise.all([
					actionsQuery.refetch(),
					reviewsQuery.refetch(),
					unreadQuery.refetch(),
					urgentQuery.refetch(),
				])
			}
			onSetRead={setRead}
			organizationSlug={input.currentOrganization.slug}
			reviewItems={reviewItems}
			updateItems={updateItems}
			urgentItems={urgentItems}
		/>
	);
}

function InboxPreviewContent(input: {
	includesRead?: boolean;
	reviewItems: readonly InboxItem[];
	urgentItems: readonly InboxItem[];
	actionItems: readonly InboxItem[];
	isError: boolean;
	isLoading: boolean;
	isStale: boolean;
	onOpenItem: (item: InboxItem) => void;
	onRetry: () => Promise<unknown>;
	onSetRead: (item: InboxItem, read: boolean) => void;
	organizationSlug: string;
	updateItems: readonly InboxItem[];
}) {
	if (input.isLoading) {
		return (
			<div aria-busy="true" className="divide-y divide-border/70">
				<span className="sr-only">Loading Inbox preview</span>
				{INBOX_PREVIEW_SKELETON_IDS.map((id) => (
					<div className="flex min-h-16 items-center gap-3 px-2 py-3" key={id}>
						<Skeleton className="size-8 shrink-0 motion-reduce:animate-none" />
						<div className="flex min-w-0 flex-1 flex-col gap-2">
							<Skeleton className="h-3.5 w-2/5 motion-reduce:animate-none" />
							<Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
						</div>
					</div>
				))}
			</div>
		);
	}
	if (input.isError) {
		return (
			<div
				className="flex min-h-36 flex-col items-center justify-center gap-3 px-4 py-6 text-center"
				role="alert"
			>
				<p className="text-muted-foreground text-sm">
					Couldn’t load your Inbox.
				</p>
				<Button onClick={() => input.onRetry()} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	const isEmpty =
		input.actionItems.length === 0 &&
		input.reviewItems.length === 0 &&
		input.updateItems.length === 0 &&
		input.urgentItems.length === 0;
	return (
		<div className="space-y-3">
			{input.isStale ? (
				<StaleDataNotice
					className="mx-0 mt-0"
					label="Inbox may be out of date."
					onRetry={input.onRetry}
				/>
			) : null}
			{isEmpty && !input.isStale ? (
				<div className="flex flex-col items-center justify-center px-4 py-4 text-center">
					<TrayIcon
						aria-hidden="true"
						className="size-5 text-muted-foreground"
					/>
					<p className="mt-3 font-medium text-foreground text-sm">
						{input.includesRead
							? "No updates yet"
							: "No unread updates or pending requests"}
					</p>
					<Link
						className="mt-2 text-xs underline underline-offset-4"
						to={buildOrganizationInboxPath(input.organizationSlug)}
					>
						Open full Inbox
					</Link>
				</div>
			) : null}
			{!isEmpty && input.actionItems.length > 0 ? (
				<InboxPreviewSection
					items={input.actionItems}
					label="Needs action"
					onOpenItem={input.onOpenItem}
					onSetRead={input.onSetRead}
					organizationSlug={input.organizationSlug}
				/>
			) : null}
			{input.reviewItems.length > 0 ? (
				<InboxPreviewSection
					items={input.reviewItems}
					label="Needs review"
					onOpenItem={input.onOpenItem}
					onSetRead={input.onSetRead}
					organizationSlug={input.organizationSlug}
				/>
			) : null}
			{!isEmpty && input.urgentItems.length > 0 ? (
				<InboxPreviewSection
					items={input.urgentItems}
					label="Urgent updates"
					onOpenItem={input.onOpenItem}
					onSetRead={input.onSetRead}
					organizationSlug={input.organizationSlug}
				/>
			) : null}
			{!isEmpty && input.updateItems.length > 0 ? (
				<InboxPreviewSection
					items={input.updateItems}
					label="Recent updates"
					onOpenItem={input.onOpenItem}
					onSetRead={input.onSetRead}
					organizationSlug={input.organizationSlug}
				/>
			) : null}
			{input.includesRead && !isEmpty && (
				<Link
					className="inline-block px-2 text-xs underline underline-offset-4"
					to={buildOrganizationInboxPath(input.organizationSlug)}
				>
					Open full Inbox
				</Link>
			)}
		</div>
	);
}

function InboxPreviewSection(input: {
	items: readonly InboxItem[];
	label: string;
	onOpenItem: (item: InboxItem) => void;
	onSetRead: (item: InboxItem, read: boolean) => void;
	organizationSlug: string;
}) {
	const sectionId = useId();
	return (
		<section aria-labelledby={sectionId}>
			<h3
				className="px-2 pb-1 font-medium text-muted-foreground text-xs"
				id={sectionId}
			>
				{input.label}
			</h3>
			<InboxItemsList
				ariaLabel={`${input.label} Inbox items`}
				density="compact"
				items={input.items}
				onOpenItem={input.onOpenItem}
				onSetRead={input.onSetRead}
				organizationSlug={input.organizationSlug}
				showItemActions={false}
			/>
		</section>
	);
}
