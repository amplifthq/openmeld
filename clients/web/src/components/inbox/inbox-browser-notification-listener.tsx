"use client";

import {
	type QueryClient,
	useInfiniteQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	clearInboxBrowserNotificationItemPending,
	type InboxBrowserNotificationDeliveryReadiness,
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
	inboxBrowserNotificationRecoveryItemQueryOptions,
	inboxItemsInfiniteQueryOptions,
	invalidateInboxSummary,
} from "#/query/organizations/inbox";

const INBOX_BROWSER_NOTIFICATION_POLL_INTERVAL_MS = 10_000;
const INBOX_BROWSER_NOTIFICATION_RETRY_INTERVAL_MS = 10_000;
const INBOX_BROWSER_NOTIFICATION_PENDING_FETCH_CONCURRENCY = 6;
const EMPTY_RECOVERED_PENDING_ITEMS: BrowserNotificationInboxItem[] = [];

export function InboxBrowserNotificationListener(input: {
	organizationId: string;
	organizationSlug: string;
	userId: string;
}) {
	const queryClient = useQueryClient();
	const { pathname } = useLocation();
	const [settingsState, setSettingsState] = useState(() => ({
		enabled: readInboxBrowserNotificationSettings({ userId: input.userId })
			.enabled,
		userId: input.userId,
	}));
	const notificationsEnabled =
		settingsState.userId === input.userId && settingsState.enabled;
	const feedIdentity = `${input.organizationId}:${input.organizationSlug}:${input.userId}:${notificationsEnabled}`;
	const [observedItemIds] = useState(() => new Set<string>());
	const [settledItemIds] = useState(() => new Set<string>());
	const [inFlightItemIds] = useState(() => new Set<string>());
	const [deliveryRetryRevision, setDeliveryRetryRevision] = useState(0);
	const [recoveredPendingItemsState, setRecoveredPendingItemsState] = useState<{
		feedIdentity: string | null;
		items: BrowserNotificationInboxItem[];
		pathname: string | null;
		retryRevision: number;
	}>({ feedIdentity: null, items: [], pathname: null, retryRevision: -1 });
	const recoveredPendingItems =
		recoveredPendingItemsState.feedIdentity === feedIdentity &&
		recoveredPendingItemsState.pathname === pathname &&
		recoveredPendingItemsState.retryRevision === deliveryRetryRevision
			? recoveredPendingItemsState.items
			: EMPTY_RECOVERED_PENDING_ITEMS;
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const retryTimerFeedIdentityRef = useRef<string | null>(null);
	const primedRef = useRef(false);
	const primedFeedIdentityRef = useRef<string | null>(null);
	const deliveryContextRef = useRef<BrowserNotificationDeliveryContext>({
		enabled: notificationsEnabled,
		feedIdentity,
		itemsById: new Map(),
		organizationId: input.organizationId,
		organizationSlug: input.organizationSlug,
		pathname,
		userId: input.userId,
	});
	const itemsQuery = useInfiniteQuery({
		...inboxItemsInfiniteQueryOptions({
			enabled: notificationsEnabled,
			organizationId: input.organizationId,
			view: "all",
		}),
		refetchInterval: notificationsEnabled
			? INBOX_BROWSER_NOTIFICATION_POLL_INTERVAL_MS
			: false,
		refetchIntervalInBackground: true,
	});
	const cancelDeliveryRetry = useCallback((ownedFeedIdentity?: string) => {
		if (
			ownedFeedIdentity !== undefined &&
			retryTimerFeedIdentityRef.current !== ownedFeedIdentity
		) {
			return;
		}
		if (retryTimerRef.current === null) {
			return;
		}
		clearTimeout(retryTimerRef.current);
		retryTimerRef.current = null;
		retryTimerFeedIdentityRef.current = null;
	}, []);
	const scheduleDeliveryRetry = useCallback(() => {
		if (retryTimerRef.current !== null) {
			if (retryTimerFeedIdentityRef.current === feedIdentity) {
				return;
			}
			cancelDeliveryRetry();
		}
		const scheduledFeedIdentity = feedIdentity;
		retryTimerFeedIdentityRef.current = scheduledFeedIdentity;
		retryTimerRef.current = setTimeout(() => {
			retryTimerRef.current = null;
			retryTimerFeedIdentityRef.current = null;
			const currentContext = deliveryContextRef.current;
			if (currentContext.feedIdentity !== scheduledFeedIdentity) {
				return;
			}
			setDeliveryRetryRevision((current) => current + 1);
		}, INBOX_BROWSER_NOTIFICATION_RETRY_INTERVAL_MS);
	}, [cancelDeliveryRetry, feedIdentity]);

	useEffect(() => {
		const ownedFeedIdentity = feedIdentity;
		return () => cancelDeliveryRetry(ownedFeedIdentity);
	}, [cancelDeliveryRetry, feedIdentity]);

	useEffect(() => {
		const refresh = (retryDelivery: boolean) => {
			const enabled = readInboxBrowserNotificationSettings({
				userId: input.userId,
			}).enabled;
			setSettingsState((current) => {
				if (current.userId === input.userId && current.enabled === enabled) {
					return current;
				}
				return { enabled, userId: input.userId };
			});
			if (retryDelivery) {
				setDeliveryRetryRevision((current) => current + 1);
			}
		};
		refresh(false);
		return subscribeInboxBrowserNotificationSettings(() => refresh(true));
	}, [input.userId]);

	useLayoutEffect(() => {
		const listedItems =
			itemsQuery.data?.pages.flatMap((page) => page.items) ?? [];
		const items = mergeInboxBrowserNotificationItems({
			listedItems,
			recoveredPendingItems,
		});
		deliveryContextRef.current = {
			enabled: notificationsEnabled,
			feedIdentity,
			itemsById: new Map(items.map((item) => [item.id, item])),
			organizationId: input.organizationId,
			organizationSlug: input.organizationSlug,
			pathname,
			userId: input.userId,
		};
		return () => {
			if (deliveryContextRef.current.feedIdentity !== feedIdentity) {
				return;
			}
			deliveryContextRef.current =
				createInactiveInboxBrowserNotificationDeliveryContext();
		};
	}, [
		feedIdentity,
		input.organizationId,
		input.organizationSlug,
		input.userId,
		itemsQuery.data,
		notificationsEnabled,
		pathname,
		recoveredPendingItems,
	]);

	useEffect(() => {
		if (!(notificationsEnabled && itemsQuery.data)) {
			return;
		}
		const listedItems = itemsQuery.data.pages.flatMap((page) => page.items);
		const availableItemIds = new Set(listedItems.map((item) => item.id));
		const missingPendingItemIds = [
			...readPendingInboxBrowserNotificationItemIds({
				organizationId: input.organizationId,
				userId: input.userId,
			}),
		].filter((itemId) => !availableItemIds.has(itemId));
		if (missingPendingItemIds.length === 0) {
			return;
		}
		let cancelled = false;
		const recoverPendingItems = async () => {
			const recoveredItems: BrowserNotificationInboxItem[] = [];
			for (
				let offset = 0;
				offset < missingPendingItemIds.length;
				offset += INBOX_BROWSER_NOTIFICATION_PENDING_FETCH_CONCURRENCY
			) {
				if (cancelled) {
					return;
				}
				const batch = missingPendingItemIds.slice(
					offset,
					offset + INBOX_BROWSER_NOTIFICATION_PENDING_FETCH_CONCURRENCY
				);
				const batchItems = await Promise.all(
					batch.map((itemId) =>
						readPendingInboxBrowserNotificationItem({
							isCancelled: () => cancelled,
							itemId,
							organizationId: input.organizationId,
							queryClient,
							retryAttempt: deliveryRetryRevision,
							scheduleDeliveryRetry,
							userId: input.userId,
						})
					)
				);
				recoveredItems.push(
					...batchItems.filter(
						(item): item is BrowserNotificationInboxItem => item !== null
					)
				);
			}
			if (cancelled) {
				return;
			}
			if (recoveredItems.length === 0) {
				return;
			}
			setRecoveredPendingItemsState({
				feedIdentity,
				items: recoveredItems,
				pathname,
				retryRevision: deliveryRetryRevision,
			});
		};
		recoverPendingItems().catch((error: unknown) => {
			if (cancelled) {
				return;
			}
			console.warn(
				"[openmeld.web.inbox.browser_notification_pending_recovery_failed]",
				{
					error: error instanceof Error ? error.message : String(error),
					organizationId: input.organizationId,
					retryAttempt: deliveryRetryRevision,
				}
			);
			scheduleDeliveryRetry();
		});
		return () => {
			cancelled = true;
		};
	}, [
		deliveryRetryRevision,
		feedIdentity,
		input.organizationId,
		input.userId,
		itemsQuery.data,
		notificationsEnabled,
		pathname,
		queryClient,
		scheduleDeliveryRetry,
	]);

	useEffect(() => {
		if (primedFeedIdentityRef.current !== feedIdentity) {
			observedItemIds.clear();
			settledItemIds.clear();
			inFlightItemIds.clear();
			primedRef.current = false;
			primedFeedIdentityRef.current = feedIdentity;
		}
		if (!(notificationsEnabled && itemsQuery.data)) {
			return;
		}
		const currentItems = mergeInboxBrowserNotificationItems({
			listedItems: itemsQuery.data.pages.flatMap((page) => page.items),
			recoveredPendingItems,
		});
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
			deliveryAttempt: deliveryRetryRevision,
			deliveryContextRef,
			feedIdentity,
			inFlightItemIds,
			items: currentItems,
			observedItemIds,
			organizationId: input.organizationId,
			organizationSlug: input.organizationSlug,
			pathname,
			queryClient,
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
		deliveryRetryRevision,
		feedIdentity,
		inFlightItemIds,
		input.organizationId,
		input.organizationSlug,
		input.userId,
		itemsQuery.data,
		notificationsEnabled,
		observedItemIds,
		pathname,
		queryClient,
		recoveredPendingItems,
		scheduleDeliveryRetry,
		settledItemIds,
	]);

	return null;
}

type BrowserNotificationInboxItem = Parameters<
	typeof isInboxBrowserNotificationEligible
>[0];

type BrowserNotificationDeliveryContext = {
	enabled: boolean;
	feedIdentity: string | null;
	itemsById: Map<string, BrowserNotificationInboxItem>;
	organizationId: string;
	organizationSlug: string;
	pathname: string | null;
	userId: string;
};

function createInactiveInboxBrowserNotificationDeliveryContext(): BrowserNotificationDeliveryContext {
	return {
		enabled: false,
		feedIdentity: null,
		itemsById: new Map(),
		organizationId: "",
		organizationSlug: "",
		pathname: null,
		userId: "",
	};
}

async function readPendingInboxBrowserNotificationItem(input: {
	isCancelled: () => boolean;
	itemId: string;
	organizationId: string;
	queryClient: QueryClient;
	retryAttempt: number;
	scheduleDeliveryRetry: () => void;
	userId: string;
}): Promise<BrowserNotificationInboxItem | null> {
	try {
		const response = await input.queryClient.fetchQuery(
			inboxBrowserNotificationRecoveryItemQueryOptions({
				itemId: input.itemId,
				organizationId: input.organizationId,
			})
		);
		return response.item;
	} catch (error) {
		if (input.isCancelled()) {
			return null;
		}
		if (isInboxItemNotFoundFailure(error)) {
			clearInboxBrowserNotificationItemPending({
				itemId: input.itemId,
				organizationId: input.organizationId,
				userId: input.userId,
			});
			return null;
		}
		console.warn(
			"[openmeld.web.inbox.browser_notification_pending_item_read_failed]",
			{
				error: error instanceof Error ? error.message : String(error),
				itemId: input.itemId,
				organizationId: input.organizationId,
				retryAttempt: input.retryAttempt,
			}
		);
		input.scheduleDeliveryRetry();
		return null;
	}
}

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
	deliveryAttempt: number;
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
	queryClient: QueryClient;
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
			resolveCurrentReadiness: async () =>
				await resolveCurrentInboxBrowserNotificationReadiness({
					deliveryContextRef: input.deliveryContextRef,
					feedIdentity: input.feedIdentity,
					itemId: item.id,
					organizationId: input.organizationId,
					queryClient: input.queryClient,
					retryAttempt: input.deliveryAttempt,
					userId: input.userId,
				}),
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
				handleInboxBrowserNotificationDeliveryResult({
					deliveryContextRef: input.deliveryContextRef,
					feedIdentity: input.feedIdentity,
					item,
					organizationId: input.organizationId,
					result,
					scheduleDeliveryRetry: input.scheduleDeliveryRetry,
					settledItemIds: input.settledItemIds,
					userId: input.userId,
				});
			})
			.catch((error: unknown) => {
				console.warn("[openmeld.web.inbox.browser_notification_failed]", {
					error: error instanceof Error ? error.message : String(error),
					itemId: item.id,
					organizationId: input.organizationId,
					retryAttempt: input.deliveryAttempt,
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

async function resolveCurrentInboxBrowserNotificationReadiness(input: {
	deliveryContextRef: { current: BrowserNotificationDeliveryContext };
	feedIdentity: string;
	itemId: string;
	organizationId: string;
	queryClient: QueryClient;
	retryAttempt: number;
	userId: string;
}): Promise<InboxBrowserNotificationDeliveryReadiness> {
	if (!isCurrentInboxBrowserNotificationDeliveryContext(input)) {
		return "context_changed";
	}

	let currentItem: BrowserNotificationInboxItem;
	try {
		const response = await input.queryClient.fetchQuery(
			inboxBrowserNotificationRecoveryItemQueryOptions({
				itemId: input.itemId,
				organizationId: input.organizationId,
			})
		);
		currentItem = response.item;
	} catch (error) {
		if (isInboxItemNotFoundFailure(error)) {
			return "ineligible";
		}
		console.warn(
			"[openmeld.web.inbox.browser_notification_revalidation_failed]",
			{
				error: error instanceof Error ? error.message : String(error),
				itemId: input.itemId,
				organizationId: input.organizationId,
				retryAttempt: input.retryAttempt,
			}
		);
		return "revalidation_failed";
	}

	if (!isCurrentInboxBrowserNotificationDeliveryContext(input)) {
		return "context_changed";
	}
	const current = input.deliveryContextRef.current;
	if (
		currentItem.id !== input.itemId ||
		currentItem.recipientUserId !== current.userId ||
		currentItem.organizationId !== current.organizationId ||
		!shouldDeliverInboxBrowserNotification(currentItem)
	) {
		return "ineligible";
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
}

function isCurrentInboxBrowserNotificationDeliveryContext(input: {
	deliveryContextRef: { current: BrowserNotificationDeliveryContext };
	feedIdentity: string;
	organizationId: string;
	userId: string;
}): boolean {
	const current = input.deliveryContextRef.current;
	return (
		current.feedIdentity === input.feedIdentity &&
		current.enabled &&
		current.organizationId === input.organizationId &&
		current.userId === input.userId
	);
}

function handleInboxBrowserNotificationDeliveryResult(input: {
	deliveryContextRef: { current: BrowserNotificationDeliveryContext };
	feedIdentity: string;
	item: BrowserNotificationInboxItem;
	organizationId: string;
	result: Awaited<ReturnType<typeof showInboxBrowserNotification>>;
	scheduleDeliveryRetry: () => void;
	settledItemIds: Set<string>;
	userId: string;
}): void {
	const current = input.deliveryContextRef.current;
	if (input.result.status === "deferred") {
		if (current.feedIdentity !== input.feedIdentity) {
			return;
		}
		if (input.result.reason === "context_changed") {
			const currentItem = current.itemsById.get(input.item.id);
			if (
				currentItem &&
				(currentItem.organizationId !== current.organizationId ||
					currentItem.recipientUserId !== current.userId ||
					!shouldDeliverInboxBrowserNotification(currentItem))
			) {
				clearPendingInboxBrowserNotificationItem({ ...input, settle: true });
				return;
			}
		}
		input.scheduleDeliveryRetry();
		return;
	}

	clearPendingInboxBrowserNotificationItem({
		...input,
		settle: current.feedIdentity === input.feedIdentity,
	});
}

function clearPendingInboxBrowserNotificationItem(input: {
	item: BrowserNotificationInboxItem;
	organizationId: string;
	settle: boolean;
	settledItemIds: Set<string>;
	userId: string;
}): void {
	clearInboxBrowserNotificationItemPending({
		itemId: input.item.id,
		organizationId: input.organizationId,
		userId: input.userId,
	});
	if (input.settle) {
		input.settledItemIds.add(input.item.id);
	}
}

function shouldDeliverInboxBrowserNotification(
	item: BrowserNotificationInboxItem
): boolean {
	return item.readAt === null && isInboxBrowserNotificationEligible(item);
}

function mergeInboxBrowserNotificationItems(input: {
	listedItems: readonly BrowserNotificationInboxItem[];
	recoveredPendingItems: readonly BrowserNotificationInboxItem[];
}): BrowserNotificationInboxItem[] {
	const listedItemIds = new Set(input.listedItems.map((item) => item.id));
	return [
		...input.listedItems,
		...input.recoveredPendingItems.filter(
			(item) => !listedItemIds.has(item.id)
		),
	];
}

function isInboxItemNotFoundFailure(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		error.status === 404
	);
}
