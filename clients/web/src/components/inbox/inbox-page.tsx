"use client";

import type {
	InboxFeedCategory,
	InboxFeedQuery,
	InboxFeedRow,
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
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AgentAccessRequestCard } from "#/components/agent-access/agent-access-request-card";
import { AppPageHeader } from "#/components/app/app-page-header";
import { MessageSearchButton } from "#/components/search/message-search";
import { CredentialConfirmationCard } from "#/components/sensitive-operations/credential-confirmation-card";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { inboxItemQueryOptions } from "#/query/organizations/inbox";
import {
	useMutateOrganizationInboxFeed,
	useOrganizationInboxFeed,
} from "#/query/organizations/inbox-feed";
import { InboxAgentInteraction } from "./inbox-agent-interaction";
import { InboxDesktopUpdateDetails } from "./inbox-desktop-update-details";
import {
	InboxFeedView,
	resolveInboxFeedLoadMoreState,
} from "./inbox-feed-view";
import { InboxFilterMenu } from "./inbox-filter-menu";
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
import { useInboxRemoval } from "./inbox-removal-dialog";
import { InvitationReview } from "./invitation-review";
import { PluginActionRequest } from "./plugin-action-request";
import { useInboxExpansion } from "./use-inbox-expansion";
import { useInboxItemDismissMutation } from "./use-inbox-item-dismiss-mutation";
import { useInboxItemReadMutation } from "./use-inbox-item-read-mutation";

function InboxSourceDetails({ target }: { target: InboxItem["sourceTarget"] }) {
	if (target.kind === "desktop_update") {
		return <InboxDesktopUpdateDetails target={target} />;
	}
	if (target.kind === "agent_access_request") {
		return (
			<AgentAccessRequestCard
				key={target.requestId}
				requestId={target.requestId}
			/>
		);
	}
	if (target.kind === "credential_confirmation") {
		return (
			<CredentialConfirmationCard
				confirmationId={target.confirmationId}
				key={target.confirmationId}
			/>
		);
	}
	if (target.kind === "agent_interaction") {
		return (
			<InboxAgentInteraction
				key={`${target.runtimeCoordinatorExecutionId}:${target.interactionId}`}
				target={target}
			/>
		);
	}
	if (target.kind === "plugin_action_request") {
		return (
			<PluginActionRequest
				key={target.requestId}
				requestId={target.requestId}
			/>
		);
	}
	return null;
}

function markReadLabel(count: number | null): string {
	if (count === null) {
		return "Mark as read";
	}
	if (count === 0) {
		return "All read";
	}
	return count === 1 ? "Mark 1 item as read" : `Mark ${count} items as read`;
}

function InboxSelectionActions(input: {
	unreadCount: number | null;
	pending: boolean;
	onMarkRead: () => void;
}) {
	return (
		<Button
			className="ml-auto"
			disabled={
				input.pending || input.unreadCount === null || input.unreadCount === 0
			}
			onClick={input.onMarkRead}
			size="sm"
			variant="secondary"
		>
			{markReadLabel(input.unreadCount)}
		</Button>
	);
}

function InboxExpansionAction({
	rows,
	expansion,
}: {
	rows: readonly InboxFeedRow[];
	expansion: ReturnType<typeof useInboxExpansion>;
}) {
	const groups = rows.filter(
		(row) => row.group?.kind === "space" || row.group?.kind === "system"
	);
	const allExpanded = groups.every((row) => expansion.isExpanded(row.groupKey));
	if (!groups.length) {
		return null;
	}
	return (
		<Button
			onClick={() => expansion.setAll(!allExpanded)}
			size="sm"
			variant="secondary"
		>
			{allExpanded ? "Collapse groups" : "Expand groups"}
		</Button>
	);
}

export function InboxPage(input: {
	searchEnabled?: boolean;
	itemId?: string;
	requestId?: string;
	onItemDismissed?: (itemId: string) => void;
	onViewChange: (view: InboxFeedCategory) => void;
	onUnreadOnlyChange?: (unreadOnly: boolean) => void;
	onFiltersChange?: (filters: {
		agentsOnly: boolean;
		peopleOnly: boolean;
		conversationType: NonNullable<InboxFeedQuery["conversationType"]>;
	}) => void;
	unreadOnly?: boolean;
	agentsOnly?: boolean;
	peopleOnly?: boolean;
	conversationType?: InboxFeedQuery["conversationType"];
	view: InboxFeedCategory;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const expansion = useInboxExpansion(currentUserId, currentOrganization.id);
	const filters = {
		grouping: "space" as const,
		category: input.view,
		unreadOnly: input.unreadOnly ?? false,
		agentsOnly: input.agentsOnly ?? false,
		peopleOnly: input.peopleOnly ?? false,
		conversationType: input.conversationType ?? "all",
	};
	const feed = useOrganizationInboxFeed({
		...filters,
		accountId: currentUserId,
		organizationId: currentOrganization.id,
	});
	const hasFilters =
		filters.agentsOnly ||
		filters.peopleOnly ||
		filters.conversationType !== "all";
	const deepLink = useQuery(
		inboxItemQueryOptions({
			organizationId: currentOrganization.id,
			itemId: input.itemId ?? "",
			enabled: Boolean(input.itemId),
		})
	);
	const [announcement, setAnnouncement] = useState("");
	const scope = `${currentUserId}:${currentOrganization.id}`;
	const [confirmation, setConfirmation] = useState<{
		snapshotId: string;
		unreadCount: number;
	} | null>(null);
	const { setRead } = useInboxItemReadMutation({
		organizationId: currentOrganization.id,
		onAnnouncement: setAnnouncement,
	});
	const { dismiss, isPending: isRemoving } = useInboxItemDismissMutation({
		organizationId: currentOrganization.id,
		onAnnouncement: setAnnouncement,
		onDismissed: input.onItemDismissed,
	});
	const selection = useMutateOrganizationInboxFeed(currentOrganization.id);
	const mutateSelection = (body: MutateInboxFeedBody) =>
		selection.mutate(body, {
			onSuccess: (response) =>
				setAnnouncement(
					`${response.changedCount} ${response.changedCount === 1 ? "activity" : "activities"} ${body.operation === "read" ? "marked as read" : "removed from Inbox"}. Pending requests remain open.`
				),
			onError: () =>
				toast.error(
					"This selection could not be updated. Refresh your Inbox and try again."
				),
		});
	const {
		requestRemoval,
		requestSelection,
		dialog: removalDialog,
	} = useInboxRemoval({
		scope,
		removalPending: isRemoving,
		selectionPending: selection.isPending,
		onDismiss: dismiss,
		onSelection: mutateSelection,
	});
	const sourceItem = deepLink.data?.item;
	const itemElement = useRef<HTMLElement | null>(null);
	const appliedItem = useRef<string | null>(null);
	const registerItem = useCallback(
		(_id: string, element: HTMLElement | null) => {
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
	const snapshotExpired = firstPage
		? Date.parse(firstPage.snapshotExpiresAt) <= Date.now()
		: false;
	const selectionPending = selection.isPending || snapshotExpired;
	const selectionUnreadCount = firstPage?.selectionUnreadCount ?? null;
	const selectionAction = (
		<InboxSelectionActions
			onMarkRead={() => {
				if (firstPage?.selectionUnreadCount !== undefined) {
					setConfirmation({
						snapshotId: firstPage.snapshotId,
						unreadCount: firstPage.selectionUnreadCount,
					});
				}
			}}
			pending={selectionPending}
			unreadCount={selectionUnreadCount}
		/>
	);
	const selectedIndex = Math.max(
		0,
		INBOX_TABS.findIndex((tab) => tab.view === input.view)
	);
	const loadMoreState = resolveInboxFeedLoadMoreState(feed, snapshotExpired);
	const refreshWarningShown = Boolean(
		feed.isRefetchError && feed.data && !feed.isFetchNextPageError
	);
	const openItem = (item: InboxItem) => setRead(item, true);
	const confirmationLabel = markReadLabel(confirmation?.unreadCount ?? null);
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
					<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
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
								<TabsSubtleItem
									index={index}
									key={tab.view}
									label={tab.label}
								/>
							))}
						</TabsSubtle>
						<label
							className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 text-muted-foreground text-sm"
							htmlFor="inbox-unread-only"
						>
							<Switch
								checked={filters.unreadOnly}
								id="inbox-unread-only"
								onCheckedChange={(value) => input.onUnreadOnlyChange?.(value)}
							/>
							Unread only
						</label>
					</div>
					<div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
						<div className="flex flex-wrap items-center gap-2">
							<InboxFilterMenu
								filters={filters}
								onChange={input.onFiltersChange}
							/>
							<MessageSearchButton
								enabled={input.searchEnabled}
								scope="inbox"
							/>
						</div>
						<InboxExpansionAction expansion={expansion} rows={rows} />
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
							onDismiss={requestRemoval}
							onOpenItem={openItem}
							onSetRead={setRead}
							organizationSlug={currentOrganization.slug}
							registerItemElement={registerItem}
						/>
						<InboxSourceDetails target={sourceItem.sourceTarget} />
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
				{refreshWarningShown ? (
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
										expansion={expansion}
										filters={filters}
										isMutating={selectionPending}
										onDismiss={requestRemoval}
										onOpenItem={openItem}
										onSelection={requestSelection}
										onSetRead={setRead}
										organizationId={currentOrganization.id}
										organizationSlug={currentOrganization.slug}
										refreshWarningShown={refreshWarningShown}
										rows={rows}
										sectionAction={selectionAction}
										snapshotId={firstPage.snapshotId}
									/>
								) : null}
								{firstPage &&
								rows.length === 0 &&
								!sourceItem &&
								!feed.hasNextPage ? (
									<InboxEmptyState
										filtered={hasFilters}
										unreadOnly={filters.unreadOnly}
										view={input.view}
									/>
								) : null}
								{loadMoreState ? (
									<InboxInfiniteScrollTrigger
										onLoadMore={async () => {
											if (!feed.isFetching) {
												await feed.fetchNextPage();
											}
										}}
										state={loadMoreState}
									/>
								) : null}
							</div>
						) : null}
					</TabsSubtlePanel>
				))}
			</div>
			{removalDialog}
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
						<AlertDialogTitle>{confirmationLabel}?</AlertDialogTitle>
						<AlertDialogDescription>
							Only items matching your current filters will be marked as read,
							including other pages. New messages and items outside this
							selection stay unread. Pending requests stay open.
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
							{confirmationLabel}
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

/** Exact deep links stay accessible even outside the selected category/page. */
export function mergeDeepLinkedInboxItem(
	items: readonly InboxItem[],
	item: InboxItem | undefined
): InboxItem[] {
	return item
		? [item, ...items.filter((candidate) => candidate.id !== item.id)]
		: [...items];
}
