"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	isInboxBrowserNotificationEligible,
	readInboxBrowserNotificationSettings,
	showInboxBrowserNotification,
	subscribeInboxBrowserNotificationSettings,
} from "#/lib/inbox/browser-notifications";
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
	const [settings, setSettings] = useState(() =>
		readInboxBrowserNotificationSettings({ userId: input.userId })
	);
	const feedIdentity = `${input.organizationId}:${input.userId}:${settings.enabled}`;
	const [seenItemIds] = useState(() => new Set<string>());
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
		if (!(settings.enabled && itemsQuery.data)) {
			return;
		}
		if (primedFeedIdentityRef.current !== feedIdentity) {
			seenItemIds.clear();
			primedRef.current = false;
			primedFeedIdentityRef.current = feedIdentity;
		}
		const currentItems = itemsQuery.data.pages.flatMap((page) => page.items);
		if (!primedRef.current) {
			for (const item of currentItems) {
				seenItemIds.add(item.id);
			}
			primedRef.current = true;
			return;
		}
		let sawNewItem = false;
		for (const item of currentItems.toReversed()) {
			if (seenItemIds.has(item.id)) {
				continue;
			}
			seenItemIds.add(item.id);
			sawNewItem = true;
			if (!shouldDeliverInboxBrowserNotification(item)) {
				continue;
			}
			showInboxBrowserNotification({
				item,
				sourcePath: buildOrganizationInboxItemPath({
					itemId: item.id,
					orgSlug: input.organizationSlug,
				}),
			}).catch((error: unknown) => {
				console.warn("[openmeld.web.inbox.browser_notification_failed]", {
					error: error instanceof Error ? error.message : String(error),
					itemId: item.id,
					organizationId: input.organizationId,
				});
			});
		}
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
		input.organizationId,
		input.organizationSlug,
		itemsQuery.data,
		queryClient,
		seenItemIds,
		settings.enabled,
	]);

	return null;
}

function shouldDeliverInboxBrowserNotification(
	item: Parameters<typeof isInboxBrowserNotificationEligible>[0]
): boolean {
	return item.readAt === null && isInboxBrowserNotificationEligible(item);
}
