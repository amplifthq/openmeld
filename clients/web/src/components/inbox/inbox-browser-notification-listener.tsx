"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	clearInboxBrowserNotificationItemPending,
	isInboxBrowserNotificationEligible,
	markInboxBrowserNotificationItemPending,
	readInboxBrowserNotificationSettings,
	readPendingInboxBrowserNotificationItemIds,
	showInboxBrowserNotification,
	subscribeInboxBrowserNotificationSettings,
} from "#/lib/inbox/browser-notifications";
import { isInboxItemSourceLocation } from "#/lib/inbox/source-target";
import { buildOrganizationInboxItemPath } from "#/lib/organizations/organization-routes";
import {
	inboxItemsInfiniteQueryOptions,
	invalidateInboxSummary,
} from "#/query/organizations/inbox";

const INBOX_BROWSER_NOTIFICATION_POLL_INTERVAL_MS = 10_000;
const INBOX_BROWSER_NOTIFICATION_RETRY_INTERVAL_MS = 10_000;

export function InboxBrowserNotificationListener(input: {
	organizationId: string;
	organizationSlug: string;
	userId: string;
}) {
	const queryClient = useQueryClient();
	const { pathname } = useLocation();
	const [settings, setSettings] = useState(() =>
		readInboxBrowserNotificationSettings({ userId: input.userId })
	);
	const feedIdentity = `${input.organizationId}:${input.organizationSlug}:${input.userId}:${settings.enabled}`;
	const [observedItemIds] = useState(() => new Set<string>());
	const [settledItemIds] = useState(() => new Set<string>());
	const [inFlightItemIds] = useState(() => new Set<string>());
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const primedRef = useRef(false);
	const primedFeedIdentityRef = useRef<string | null>(null);
	const deliveryContextRef = useRef<BrowserNotificationDeliveryContext>({
		enabled: settings.enabled,
		feedIdentity,
		itemsById: new Map(),
		organizationId: input.organizationId,
		organizationSlug: input.organizationSlug,
		pathname,
		userId: input.userId,
	});
	const itemsQuery = useInfiniteQuery({
		...inboxItemsInfiniteQueryOptions({
			enabled: settings.enabled,
			organizationId: input.organizationId,
			view: "all",
		}),
		refetchInterval: settings.enabled
			? INBOX_BROWSER_NOTIFICATION_POLL_INTERVAL_MS
			: false,
		refetchIntervalInBackground: true,
	});
	const scheduleDeliveryRetry = useCallback(() => {
		if (retryTimerRef.current !== null) {
			return;
		}
		retryTimerRef.current = setTimeout(() => {
			retryTimerRef.current = null;
			setSettings(
				readInboxBrowserNotificationSettings({ userId: input.userId })
			);
		}, INBOX_BROWSER_NOTIFICATION_RETRY_INTERVAL_MS);
	}, [input.userId]);

	useEffect(
		() => () => {
			if (retryTimerRef.current !== null) {
				clearTimeout(retryTimerRef.current);
			}
		},
		[]
	);

	useEffect(() => {
		const refresh = () => {
			setSettings(
				readInboxBrowserNotificationSettings({ userId: input.userId })
			);
		};
		refresh();
		return subscribeInboxBrowserNotificationSettings(refresh);
	}, [input.userId]);

	useEffect(() => {
		const items = itemsQuery.data?.pages.flatMap((page) => page.items) ?? [];
		deliveryContextRef.current = {
			enabled: settings.enabled,
			feedIdentity,
			itemsById: new Map(items.map((item) => [item.id, item])),
			organizationId: input.organizationId,
			organizationSlug: input.organizationSlug,
			pathname,
			userId: input.userId,
		};
	}, [
		feedIdentity,
		input.organizationId,
		input.organizationSlug,
		input.userId,
		itemsQuery.data,
		pathname,
		settings.enabled,
	]);

	useEffect(() => {
		if (primedFeedIdentityRef.current !== feedIdentity) {
			observedItemIds.clear();
			settledItemIds.clear();
			inFlightItemIds.clear();
			primedRef.current = false;
			primedFeedIdentityRef.current = feedIdentity;
		}
		if (!(settings.enabled && itemsQuery.data)) {
			return;
		}
		const currentItems = itemsQuery.data.pages.flatMap((page) => page.items);
		if (!primedRef.current) {
			primeInboxBrowserNotificationFeed({
				items: currentItems,
				observedItemIds,
				organizationId: input.organizationId,
				pendingItemIds: readPendingInboxBrowserNotificationItemIds({
					organizationId: input.organizationId,
					userId: input.userId,
				}),
				settledItemIds,
				userId: input.userId,
			});
			primedRef.current = true;
		}
		const sawNewItem = processInboxBrowserNotificationItems({
			deliveryContextRef,
			feedIdentity,
			inFlightItemIds,
			items: currentItems,
			observedItemIds,
			organizationId: input.organizationId,
			organizationSlug: input.organizationSlug,
			pathname,
			scheduleDeliveryRetry,
			settledItemIds,
			userId: input.userId,
		});
		if (sawNewItem) {
			invalidateInboxSummary({
				organizationId: input.organizationId,
				queryClient,
			}).catch((error: unknown) => {
				console.warn("[openmeld.web.inbox.summary_refresh_failed]", {
					error: error instanceof Error ? error.message : String(error),
					organizationId: input.organizationId,
				});
			});
		}
	}, [
		feedIdentity,
		inFlightItemIds,
		input.organizationId,
		input.organizationSlug,
		input.userId,
		itemsQuery.data,
		observedItemIds,
		pathname,
		queryClient,
		scheduleDeliveryRetry,
		settledItemIds,
		settings,
	]);

	return null;
}

type BrowserNotificationInboxItem = Parameters<
	typeof isInboxBrowserNotificationEligible
>[0];

type BrowserNotificationDeliveryContext = {
	enabled: boolean;
	feedIdentity: string;
	itemsById: Map<string, BrowserNotificationInboxItem>;
	organizationId: string;
	organizationSlug: string;
	pathname: string | null;
	userId: string;
};

function primeInboxBrowserNotificationFeed(input: {
	items: readonly BrowserNotificationInboxItem[];
	observedItemIds: Set<string>;
	organizationId: string;
	pendingItemIds: ReadonlySet<string>;
	settledItemIds: Set<string>;
	userId: string;
}): void {
	for (const item of input.items) {
		input.observedItemIds.add(item.id);
		if (
			input.pendingItemIds.has(item.id) &&
			shouldDeliverInboxBrowserNotification(item)
		) {
			continue;
		}
		input.settledItemIds.add(item.id);
		if (input.pendingItemIds.has(item.id)) {
			clearInboxBrowserNotificationItemPending({
				itemId: item.id,
				organizationId: input.organizationId,
				userId: input.userId,
			});
		}
	}
}

function processInboxBrowserNotificationItems(input: {
	deliveryContextRef: {
		current: BrowserNotificationDeliveryContext;
	};
	feedIdentity: string;
	inFlightItemIds: Set<string>;
	items: readonly BrowserNotificationInboxItem[];
	observedItemIds: Set<string>;
	organizationId: string;
	organizationSlug: string;
	pathname: string | null;
	scheduleDeliveryRetry: () => void;
	settledItemIds: Set<string>;
	userId: string;
}): boolean {
	let sawNewItem = false;
	for (const item of input.items.toReversed()) {
		if (!input.observedItemIds.has(item.id)) {
			input.observedItemIds.add(item.id);
			sawNewItem = true;
		}
		if (
			input.settledItemIds.has(item.id) ||
			input.inFlightItemIds.has(item.id)
		) {
			continue;
		}
		if (!shouldDeliverInboxBrowserNotification(item)) {
			input.settledItemIds.add(item.id);
			clearInboxBrowserNotificationItemPending({
				itemId: item.id,
				organizationId: input.organizationId,
				userId: input.userId,
			});
			continue;
		}
		markInboxBrowserNotificationItemPending({
			itemId: item.id,
			organizationId: input.organizationId,
			userId: input.userId,
		});
		input.inFlightItemIds.add(item.id);
		const isCurrentFeed = () =>
			input.deliveryContextRef.current.feedIdentity === input.feedIdentity;
		showInboxBrowserNotification({
			item,
			resolveCurrentReadiness: () => {
				const current = input.deliveryContextRef.current;
				if (
					current.feedIdentity !== input.feedIdentity ||
					!current.enabled ||
					current.organizationId !== input.organizationId ||
					current.userId !== input.userId
				) {
					return "context_changed";
				}
				const currentItem = current.itemsById.get(item.id);
				if (
					!currentItem ||
					currentItem.recipientUserId !== current.userId ||
					currentItem.organizationId !== current.organizationId ||
					!shouldDeliverInboxBrowserNotification(currentItem)
				) {
					return "context_changed";
				}
				if (
					document.visibilityState === "visible" &&
					isInboxItemSourceLocation({
						item: currentItem,
						orgSlug: current.organizationSlug,
						pathname: current.pathname,
					})
				) {
					return "source_visible";
				}
				return "eligible";
			},
			sourcePath: buildOrganizationInboxItemPath({
				itemId: item.id,
				orgSlug: input.organizationSlug,
			}),
			viewingSourceSession: isInboxItemSourceLocation({
				item,
				orgSlug: input.organizationSlug,
				pathname: input.pathname,
			}),
		})
			.then((result) => {
				if (
					result.status === "deferred" &&
					(result.reason === "claim_failed" ||
						result.reason === "permission_unavailable")
				) {
					if (isCurrentFeed()) {
						input.scheduleDeliveryRetry();
					}
					return;
				}
				if (
					result.status === "delivered" ||
					result.status === "already_delivered" ||
					result.status === "ineligible"
				) {
					clearInboxBrowserNotificationItemPending({
						itemId: item.id,
						organizationId: input.organizationId,
						userId: input.userId,
					});
					if (isCurrentFeed()) {
						input.settledItemIds.add(item.id);
					}
				}
			})
			.catch((error: unknown) => {
				console.warn("[openmeld.web.inbox.browser_notification_failed]", {
					error: error instanceof Error ? error.message : String(error),
					itemId: item.id,
					organizationId: input.organizationId,
				});
				if (isCurrentFeed()) {
					input.scheduleDeliveryRetry();
				}
			})
			.finally(() => {
				input.inFlightItemIds.delete(item.id);
			});
	}
	return sawNewItem;
}

function shouldDeliverInboxBrowserNotification(
	item: BrowserNotificationInboxItem
): boolean {
	return item.readAt === null && isInboxBrowserNotificationEligible(item);
}
