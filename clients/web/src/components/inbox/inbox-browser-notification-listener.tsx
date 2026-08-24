"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
	isInboxBrowserNotificationEligible,
	readInboxBrowserNotificationSettings,
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
	const feedIdentity = `${input.organizationId}:${input.userId}:${settings.enabled}`;
	const [observedItemIds] = useState(() => new Set<string>());
	const [settledItemIds] = useState(() => new Set<string>());
	const [inFlightItemIds] = useState(() => new Set<string>());
	const primedRef = useRef(false);
	const primedFeedIdentityRef = useRef<string | null>(null);
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
		if (
			primeInboxBrowserNotificationFeed({
				items: currentItems,
				observedItemIds,
				primed: primedRef.current,
				settledItemIds,
			})
		) {
			primedRef.current = true;
			return;
		}
		const sawNewItem = processInboxBrowserNotificationItems({
			inFlightItemIds,
			items: currentItems,
			observedItemIds,
			organizationId: input.organizationId,
			organizationSlug: input.organizationSlug,
			pathname,
			settledItemIds,
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
		itemsQuery.data,
		observedItemIds,
		pathname,
		queryClient,
		settledItemIds,
		settings,
	]);

	return null;
}

type BrowserNotificationInboxItem = Parameters<
	typeof isInboxBrowserNotificationEligible
>[0];

function primeInboxBrowserNotificationFeed(input: {
	items: readonly BrowserNotificationInboxItem[];
	observedItemIds: Set<string>;
	primed: boolean;
	settledItemIds: Set<string>;
}): boolean {
	if (input.primed) {
		return false;
	}
	for (const item of input.items) {
		input.observedItemIds.add(item.id);
		input.settledItemIds.add(item.id);
	}
	return true;
}

function processInboxBrowserNotificationItems(input: {
	inFlightItemIds: Set<string>;
	items: readonly BrowserNotificationInboxItem[];
	observedItemIds: Set<string>;
	organizationId: string;
	organizationSlug: string;
	pathname: string | null;
	settledItemIds: Set<string>;
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
			continue;
		}
		input.inFlightItemIds.add(item.id);
		showInboxBrowserNotification({
			item,
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
					result.status === "delivered" ||
					result.status === "already_delivered" ||
					result.status === "ineligible"
				) {
					input.settledItemIds.add(item.id);
				}
			})
			.catch((error: unknown) => {
				console.warn("[openmeld.web.inbox.browser_notification_failed]", {
					error: error instanceof Error ? error.message : String(error),
					itemId: item.id,
					organizationId: input.organizationId,
				});
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
