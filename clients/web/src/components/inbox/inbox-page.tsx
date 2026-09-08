"use client";

import type {
	InboxItem,
	InboxSummaryResponse,
	InboxView,
	MarkAllInboxItemsReadResponse,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	TabsSubtle,
	TabsSubtleItem,
	TabsSubtlePanel,
} from "@openmeld/ui/fluid/tabs-subtle";
import { resolveStatusToneCompactBadgeClassName } from "@openmeld/ui/lib/status-tone";
import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppPageHeader } from "#/components/app/app-page-header";
import {
	type InboxFailure,
	markAllCurrentInboxItemsRead,
} from "#/lib/organizations/inbox";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	inboxItemQueryOptions,
	inboxItemsInfiniteQueryOptions,
	inboxQueryKeys,
	inboxSummaryQueryOptions,
	invalidateInboxFacts,
} from "#/query/organizations/inbox";
import {
	captureInboxCacheSnapshots,
	type InboxCacheSnapshots,
	restoreInboxCacheSnapshots,
	updateAllCachedInboxItems,
} from "./inbox-page-cache";
import {
	InboxItemLookupWarning,
	InboxRefreshWarning,
	InboxViewContent,
} from "./inbox-page-presentation";
import { INBOX_TABS } from "./inbox-page-tabs";
import { useInboxItemDismissMutation } from "./use-inbox-item-dismiss-mutation";
import { useInboxItemReadMutation } from "./use-inbox-item-read-mutation";

export function InboxPage(input: {
	itemId?: string;
	onItemDismissed?: (itemId: string) => void;
	onViewChange: (view: InboxView) => void;
	view: InboxView;
}) {
	const queryClient = useQueryClient();
	const { currentOrganization } = useAppOrganization();
	const [announcement, setAnnouncement] = useState("");
	const [itemElements] = useState(() => new Map<string, HTMLAnchorElement>());
	const appliedItemIdRef = useRef<string | null>(null);
	const [deepLinkMarkedReadItemIds] = useState(() => new Set<string>());
	const itemsQuery = useInfiniteQuery(
		inboxItemsInfiniteQueryOptions({
			organizationId: currentOrganization.id,
			view: input.view,
		})
	);
	const summaryQuery = useQuery(
		inboxSummaryQueryOptions({ organizationId: currentOrganization.id })
	);
	const deepLinkedItemQuery = useQuery(
		inboxItemQueryOptions({
			enabled: input.itemId !== undefined,
			itemId: input.itemId ?? "",
			organizationId: currentOrganization.id,
		})
	);
	const listedItems = useMemo(
		() => itemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
		[itemsQuery.data]
	);
	const items = useMemo(
		() => mergeDeepLinkedInboxItem(listedItems, deepLinkedItemQuery.data?.item),
		[deepLinkedItemQuery.data?.item, listedItems]
	);
	const focusedItemId =
		input.itemId && deepLinkedItemQuery.data?.item.id === input.itemId
			? input.itemId
			: undefined;
	const selectedIndex = Math.max(
		0,
		INBOX_TABS.findIndex((tab) => tab.view === input.view)
	);
	const unresolvedActionCount = summaryQuery.data?.unresolvedActionCount ?? 0;
	const unresolvedActionSummary = `${unresolvedActionCount} ${
		unresolvedActionCount === 1 ? "item needs" : "items need"
	} action`;
	const registerItemElement = useCallback(
		(itemId: string, element: HTMLAnchorElement | null) => {
			if (element) {
				itemElements.set(itemId, element);
				return;
			}
			itemElements.delete(itemId);
		},
		[itemElements]
	);

	const { setRead: markItemRead } = useInboxItemReadMutation({
		onAnnouncement: setAnnouncement,
		organizationId: currentOrganization.id,
	});
	const { dismiss: dismissItem } = useInboxItemDismissMutation({
		onAnnouncement: setAnnouncement,
		onDismissed: input.onItemDismissed,
		organizationId: currentOrganization.id,
	});

	const markAllReadMutation = useMutation<
		MarkAllInboxItemsReadResponse,
		InboxFailure,
		void,
		InboxCacheSnapshots
	>({
		mutationFn: async () =>
			await markAllCurrentInboxItemsRead({
				organizationId: currentOrganization.id,
			}),
		onError: (_error, _variables, context) => {
			restoreInboxCacheSnapshots(queryClient, context);
			setAnnouncement("Could not mark all Inbox items as read.");
			toast.error("Could not mark all Inbox items as read.");
		},
		onMutate: async () => {
			await queryClient.cancelQueries({
				queryKey: inboxQueryKeys.organization(currentOrganization.id),
			});
			const context = captureInboxCacheSnapshots(
				queryClient,
				currentOrganization.id
			);
			const readAt = new Date().toISOString();
			updateAllCachedInboxItems({
				organizationId: currentOrganization.id,
				queryClient,
				update: (item) => (item.readAt === null ? { ...item, readAt } : item),
			});
			queryClient.setQueryData<InboxSummaryResponse>(
				inboxQueryKeys.summary(currentOrganization.id),
				(current) => (current ? { ...current, totalUnreadCount: 0 } : current)
			);
			return context;
		},
		onSettled: async () => {
			await invalidateInboxFacts({
				organizationId: currentOrganization.id,
				queryClient,
			});
		},
		onSuccess: (response) => {
			setAnnouncement(
				response.markedReadCount === 1
					? "1 Inbox item marked as read."
					: `${response.markedReadCount} Inbox items marked as read.`
			);
		},
	});

	useEffect(() => {
		if (!input.itemId) {
			appliedItemIdRef.current = null;
			return;
		}
		applyInboxItemDeepLinkFocus({
			appliedItemIdRef,
			deepLinkMarkedReadItemIds,
			item: deepLinkedItemQuery.data?.item,
			itemElements,
			markItemRead,
			setAnnouncement,
		});
	}, [
		deepLinkedItemQuery.data?.item,
		deepLinkMarkedReadItemIds,
		input.itemId,
		itemElements,
		markItemRead,
	]);

	return (
		<div className="flex min-w-0 flex-col gap-6">
			<AppPageHeader
				action={
					summaryQuery.data && summaryQuery.data.totalUnreadCount > 0 ? (
						<Button
							disabled={markAllReadMutation.isPending}
							onClick={() => markAllReadMutation.mutate()}
							size="sm"
							variant="outline"
						>
							{markAllReadMutation.isPending
								? "Marking as read…"
								: "Mark all as read"}
						</Button>
					) : null
				}
				description="Updates and requests that need your attention."
				eyebrow={
					currentOrganization.isPersonal
						? "Personal workspace"
						: currentOrganization.name
				}
				id="inbox-heading"
				title="Inbox"
			/>

			<div className="flex min-w-0 flex-col gap-4">
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

				{unresolvedActionCount > 0 ? (
					<output
						aria-label={unresolvedActionSummary}
						className="flex w-fit items-center gap-2 text-muted-foreground text-sm"
					>
						<Badge
							aria-hidden="true"
							className={resolveStatusToneCompactBadgeClassName("warning")}
							variant="outline"
						>
							{unresolvedActionSummary}
						</Badge>
					</output>
				) : null}

				{deepLinkedItemQuery.error?.status === 404 ? (
					<output
						aria-label="Inbox item isn't available"
						className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground text-sm"
					>
						This Inbox item isn’t available. It may have been removed or you may
						no longer have access.
					</output>
				) : null}
				{deepLinkedItemQuery.isError &&
				deepLinkedItemQuery.error.status !== 404 ? (
					<InboxItemLookupWarning
						onRetry={() => deepLinkedItemQuery.refetch()}
					/>
				) : null}

				{itemsQuery.isRefetchError &&
				!itemsQuery.isFetchNextPageError &&
				itemsQuery.data ? (
					<InboxRefreshWarning onRetry={() => itemsQuery.refetch()} />
				) : null}

				{INBOX_TABS.map((tab, index) => (
					<TabsSubtlePanel
						idPrefix="inbox-view"
						index={index}
						key={tab.view}
						selectedIndex={selectedIndex}
					>
						<InboxViewContent
							focusedItemId={focusedItemId}
							isError={itemsQuery.isError && !itemsQuery.data}
							isLoading={itemsQuery.isPending}
							items={items}
							loadMoreState={resolveInboxLoadMoreState(itemsQuery)}
							onDismiss={dismissItem}
							onLoadMore={() => itemsQuery.fetchNextPage()}
							onOpenItem={(item) => markItemRead(item, true)}
							onRetry={() => itemsQuery.refetch()}
							onSetRead={markItemRead}
							organizationSlug={currentOrganization.slug}
							registerItemElement={registerItemElement}
							view={tab.view}
						/>
					</TabsSubtlePanel>
				))}
			</div>

			<div aria-atomic="true" aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</div>
	);
}

function resolveInboxLoadMoreState(input: {
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	isFetchNextPageError: boolean;
}): "error" | "idle" | "loading" | undefined {
	if (input.isFetchingNextPage) {
		return "loading";
	}
	if (input.isFetchNextPageError) {
		return "error";
	}
	return input.hasNextPage ? "idle" : undefined;
}

function applyInboxItemDeepLinkFocus(input: {
	appliedItemIdRef: { current: string | null };
	deepLinkMarkedReadItemIds: Set<string>;
	item: InboxItem | undefined;
	itemElements: ReadonlyMap<string, HTMLAnchorElement>;
	markItemRead: (item: InboxItem, read: boolean) => void;
	setAnnouncement: (announcement: string) => void;
}): boolean {
	if (!input.item) {
		return false;
	}
	if (input.appliedItemIdRef.current === input.item.id) {
		return true;
	}
	const targetElement = input.itemElements.get(input.item.id);
	if (!targetElement) {
		return true;
	}
	input.appliedItemIdRef.current = input.item.id;
	if (
		input.item.readAt === null &&
		!input.deepLinkMarkedReadItemIds.has(input.item.id)
	) {
		input.deepLinkMarkedReadItemIds.add(input.item.id);
		input.markItemRead(input.item, true);
	}
	targetElement.scrollIntoView({ block: "center" });
	targetElement.focus({ preventScroll: true });
	input.setAnnouncement(`${input.item.title} selected in Inbox.`);
	return true;
}

function mergeDeepLinkedInboxItem(
	items: readonly InboxItem[],
	deepLinkedItem: InboxItem | undefined
): readonly InboxItem[] {
	if (!deepLinkedItem || items.some((item) => item.id === deepLinkedItem.id)) {
		return items;
	}
	return [deepLinkedItem, ...items];
}
