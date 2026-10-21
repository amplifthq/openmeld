"use client";
import {
	inboxMessageNotificationSpaceId,
	isInboxItemInOrganizationScope,
	isInboxNotificationEligible,
} from "@openmeld/api-client";
import { accountInvalidationFrameSchema } from "@openmeld/schemas";

import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useCurrentComputer } from "#/components/app/current-computer";
import { useInboxVisibleConversation } from "#/components/inbox/inbox-visible-conversation";
import { getDesktopPlatform } from "#/desktop/platform";
import { useDesktopUpdater } from "#/desktop/updater";
import { createAccountInvalidationTransport } from "#/lib/inbox/account-invalidation-transport";
import {
	clearInboxNotificationItemPending,
	type InboxNotificationDeliveryReadiness,
	markInboxNotificationItemPending,
	readInboxNotificationSettings,
	readPendingInboxNotificationItemIds,
	showInboxNotification,
	subscribeInboxNotificationSettings,
} from "#/lib/inbox/client-notifications";
import { isNotificationConversationVisible } from "#/lib/inbox/desktop-notifications";
import { createInboxNotificationObserver } from "#/lib/inbox/notification-observer";
import {
	CONNECTED_INBOX_RECOVERY_POLL_INTERVAL_MS,
	createInboxObservationBackoff,
	resolveInboxObservationPollInterval,
} from "#/lib/inbox/observation-poll-policy";
import { requestInboxSourceFocus } from "#/lib/inbox/source-focus-request";
import {
	buildInboxItemSourceNavigation,
	isInboxItemSourceLocation,
} from "#/lib/inbox/source-target";
import {
	getCurrentInboxItem,
	getCurrentInboxMessageNotificationPreferences,
} from "#/lib/organizations/inbox";
import {
	inboxBrowserNotificationRecoveryItemQueryOptions,
	inboxQueryKeys,
	inboxSummaryQueryOptions,
	invalidateInboxFacts,
} from "#/query/organizations/inbox";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

const INBOX_NOTIFICATION_RETRY_INTERVAL_MS = 10_000;
const INBOX_NOTIFICATION_PENDING_FETCH_CONCURRENCY = 6;
const EMPTY_RECOVERED_PENDING_ITEMS: NotificationInboxItem[] = [];

function parseAccountInvalidationFrame(data: string) {
	try {
		const frame = accountInvalidationFrameSchema.safeParse(JSON.parse(data));
		return frame.success ? frame.data : null;
	} catch {
		return null;
	}
}

function resolveTrayComputerStatusTone(
	computer: ReturnType<typeof useCurrentComputer>
): "connected" | "offline" | "attention" {
	if (computer?.status?.reason === "ready") {
		return "connected";
	}
	if (
		computer?.status?.reason === "service_not_connected" ||
		computer?.statusLabel === "Not connected"
	) {
		return "offline";
	}
	return "attention";
}

export function InboxNotificationListener(input: {
	organizationId: string;
	organizationSlug: string;
	userId: string;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const updater = useDesktopUpdater();
	const notificationNavigationPaused =
		Boolean(getDesktopPlatform()) &&
		(!updater ||
			updater.status === "preparing" ||
			updater.status === "installing" ||
			updater.errorStage === "install");
	useEffect(() => {
		if (notificationNavigationPaused) {
			return;
		}
		const unsubscribe = getDesktopPlatform()?.onNotificationClick(
			(reference) => {
				if (reference.userId !== input.userId) {
					return;
				}
				const navigation = buildInboxItemSourceNavigation({
					item: reference,
					orgSlug: reference.organizationSlug,
				});
				if (navigation.openInNewTab) {
					return;
				}
				navigate({
					to: navigation.href,
					state: requestInboxSourceFocus,
				}).catch((error: unknown) =>
					console.warn("[openmeld.desktop.notification_navigation_failed]", {
						error,
					})
				);
			}
		);
		return () => {
			unsubscribe?.();
		};
	}, [input.userId, navigate, notificationNavigationPaused]);
	const { pathname, state: locationState } = useLocation();
	const navigationKey = locationState?.__TSR_key;
	const visibleConversation = useInboxVisibleConversation();
	const computer = useCurrentComputer();
	const trayComputerStatusTone = resolveTrayComputerStatusTone(computer);
	const [settingsState, setSettingsState] = useState(() => ({
		enabled: readInboxNotificationSettings({ userId: input.userId }).enabled,
		userId: input.userId,
	}));
	const notificationsEnabled =
		settingsState.userId === input.userId && settingsState.enabled;
	// Observe the shared Inbox summary; the existing native cadence refreshes it.
	const summaryQuery = useQuery({
		...inboxSummaryQueryOptions({
			organizationId: input.organizationId,
			enabled: Boolean(getDesktopPlatform()),
		}),
		refetchInterval: false,
	});
	const refetchSummary = summaryQuery.refetch;
	const attentionSummary = summaryQuery.data;
	const attention = useMemo(
		() =>
			summaryQuery.isError ||
			attentionSummary?.unreadUrgentUpdateCount === undefined ||
			attentionSummary.unreadMentionCount === undefined ||
			attentionSummary.ordinaryUnreadCount === undefined
				? null
				: {
						ordinaryUnreadCount: attentionSummary.ordinaryUnreadCount,
						unreadMentionCount: attentionSummary.unreadMentionCount,
						unreadUrgentUpdateCount: attentionSummary.unreadUrgentUpdateCount,
						unresolvedActionCount: attentionSummary.unresolvedActionCount,
						...(attentionSummary.priorityCount === undefined
							? {}
							: {
									priorityCount: attentionSummary.priorityCount,
									needsActionCount: attentionSummary.needsActionCount,
									needsReviewCount: attentionSummary.needsReviewCount,
									unreadPriorityUpdateCount:
										attentionSummary.unreadPriorityUpdateCount,
								}),
					},
		[attentionSummary, summaryQuery.isError]
	);
	const unreadCount = summaryQuery.isError
		? null
		: (summaryQuery.data?.totalUnreadCount ?? null);
	let unreadCountStatus: "loading" | "ready" | "unavailable" = "loading";
	if (summaryQuery.isError) {
		unreadCountStatus = "unavailable";
	} else if (summaryQuery.data) {
		unreadCountStatus = "ready";
	}
	const desktop = getDesktopPlatform();
	const [connectedStreamScope, setConnectedStreamScope] = useState<
		string | null
	>(null);
	const streamScope = `${input.userId}:${input.organizationId}`;
	const notificationFeed = useMemo(
		() => ({
			read: createInboxNotificationObserver({
				deliveryEnabled: notificationsEnabled,
				organizationId: input.organizationId,
				userId: input.userId,
			}),
		}),
		[input.organizationId, input.userId, notificationsEnabled]
	);
	const [observationBackoff] = useState(() => createInboxObservationBackoff());
	const streamConnected = connectedStreamScope === streamScope;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a stream state change restarts the disconnected backoff.
	useEffect(() => {
		observationBackoff.reset();
	}, [observationBackoff, streamConnected]);
	useEffect(() => {
		// Returning to the window restarts the disconnected backoff; TanStack
		// Query's own focus refetch performs the immediate read.
		const restart = () => {
			if (document.visibilityState === "visible") {
				observationBackoff.reset();
			}
		};
		document.addEventListener("visibilitychange", restart);
		window.addEventListener("focus", restart);
		return () => {
			document.removeEventListener("visibilitychange", restart);
			window.removeEventListener("focus", restart);
		};
	}, [observationBackoff]);
	const itemsQuery = useQuery({
		queryKey: [
			...inboxQueryKeys.organization(input.organizationId),
			"notification-observations",
			input.userId,
			notificationsEnabled,
		],
		queryFn: ({ signal }) => notificationFeed.read(signal),
		enabled: true,
		gcTime: 0,
		staleTime: 0,
		// The cursor response is empty between events; only a new Space message
		// refreshes the full account Space directory.
		refetchInterval: (query) => {
			// A failed read leaves the previous page in place; only a page from
			// the latest read counts for draining or as fresh activity.
			const dataIsCurrent =
				(query.state.dataUpdatedAt ?? 0) >= (query.state.errorUpdatedAt ?? 0);
			return resolveInboxObservationPollInterval({
				hasMore: dataIsCurrent && Boolean(query.state.data?.hasMore),
				sawItems: dataIsCurrent && (query.state.data?.items?.length ?? 0) > 0,
				visible:
					typeof document !== "undefined" &&
					document.visibilityState === "visible",
				streamConnected,
				notificationsEnabled,
				desktop: Boolean(desktop),
				fetchKey: `${query.state.dataUpdatedAt ?? 0}:${query.state.errorUpdatedAt ?? 0}`,
				backoff: observationBackoff,
			});
		},
		refetchIntervalInBackground: notificationsEnabled,
	});
	useEffect(() => {
		setConnectedStreamScope(null);
		let stopped = false;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let pingTimer: ReturnType<typeof setInterval> | null = null;
		let spaceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
		let summaryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
		let connection: ReturnType<typeof createAccountInvalidationTransport> =
			null;
		let retryCount = 0;
		const refreshInbox = () => {
			itemsQuery
				.refetch({ cancelRefetch: false })
				.catch((error: unknown) =>
					console.warn("[openmeld.web.inbox.stream_refresh_failed]", { error })
				);
		};
		const refreshSpaces = () => {
			queryClient
				.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
					predicate: (query) =>
						query.queryKey[3] === "account" || query.queryKey[3] === "profile",
				})
				.catch((error: unknown) =>
					console.warn("[openmeld.web.space.directory_refresh_failed]", {
						error,
					})
				);
		};
		const scheduleSpaceRefresh = () => {
			if (spaceRefreshTimer) {
				return;
			}
			spaceRefreshTimer = setTimeout(() => {
				spaceRefreshTimer = null;
				if (!stopped) {
					refreshSpaces();
				}
			}, 75);
		};
		// The observation cursor only reports insertions. A read or resolve
		// elsewhere changes the Desktop tray count without a new item, so push
		// refreshes the summary directly, coalesced across bursts. Web reads its
		// summary through its own mounted observers.
		const scheduleSummaryRefresh = () => {
			if (!desktop || summaryRefreshTimer) {
				return;
			}
			summaryRefreshTimer = setTimeout(() => {
				summaryRefreshTimer = null;
				if (stopped) {
					return;
				}
				refetchSummary({ cancelRefetch: false }).catch((error: unknown) =>
					console.warn("[openmeld.desktop.inbox_summary_refresh_failed]", {
						error,
					})
				);
			}, 1000);
		};
		const connect = () => {
			if (stopped) {
				return;
			}
			connection = createAccountInvalidationTransport({
				organizationId: input.organizationId,
				desktop,
			});
			const socket = connection;
			if (!socket) {
				return; // Older Desktop builds keep the cursor polling fallback.
			}
			socket.addEventListener("open", () => {
				if (stopped) {
					return;
				}
				setConnectedStreamScope(streamScope);
				refreshInbox();
				refreshSpaces();
				pingTimer = setInterval(() => {
					try {
						socket.send("ping");
					} catch {
						socket.close();
					}
				}, 25_000);
			});
			socket.addEventListener("message", (event) => {
				if (
					!(event instanceof MessageEvent) ||
					typeof event.data !== "string"
				) {
					return;
				}
				// An upgrade alone does not prove a stable connection. Keep backing
				// off short-lived connections until an end-to-end keepalive succeeds.
				if (event.data === "pong") {
					retryCount = 0;
					return;
				}
				const frame = parseAccountInvalidationFrame(event.data);
				if (!frame) {
					return;
				}
				if (frame.type === "inbox.changed") {
					refreshInbox();
					scheduleSummaryRefresh();
				} else {
					scheduleSpaceRefresh();
				}
			});
			socket.addEventListener("close", () => {
				if (pingTimer) {
					clearInterval(pingTimer);
					pingTimer = null;
				}
				if (stopped) {
					return;
				}
				setConnectedStreamScope(null);
				reconnectTimer = setTimeout(
					connect,
					Math.min(30_000, 1000 * 2 ** retryCount)
				);
				retryCount = Math.min(5, retryCount + 1);
			});
		};
		connect();
		return () => {
			stopped = true;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
			}
			if (pingTimer) {
				clearInterval(pingTimer);
			}
			if (spaceRefreshTimer) {
				clearTimeout(spaceRefreshTimer);
			}
			if (summaryRefreshTimer) {
				clearTimeout(summaryRefreshTimer);
			}
			connection?.close();
		};
	}, [
		desktop,
		input.organizationId,
		itemsQuery.refetch,
		queryClient,
		refetchSummary,
		streamScope,
	]);
	const feedIdentity = `${input.organizationId}:${input.organizationSlug}:${input.userId}:${notificationsEnabled}`;
	const deliveryAbortRef = useRef<{
		feedIdentity: string;
		controller: AbortController;
	} | null>(null);
	useLayoutEffect(() => {
		const controller = new AbortController();
		deliveryAbortRef.current = { feedIdentity, controller };
		return () => controller.abort();
	}, [feedIdentity]);
	let latestUnreadStatus: "loading" | "ready" | "unavailable" = "loading";
	if (itemsQuery.isError) {
		latestUnreadStatus = "unavailable";
	} else if (itemsQuery.data) {
		latestUnreadStatus = "ready";
	}
	// An empty cursor poll updates dataUpdatedAt but cannot change the native
	// preview. Only a cursor advance should trigger another native Inbox read.
	// biome-ignore lint/correctness/useExhaustiveDependencies: dataUpdatedAt is a payload for cursor changes, not a refresh trigger.
	useLayoutEffect(() => {
		if (!desktop) {
			return;
		}
		const reportFailure = (error: unknown) =>
			console.warn("[openmeld.desktop.notification_context_failed]", { error });
		desktop
			.setNotificationContext({
				attention,
				userId: input.userId,
				organizationId: input.organizationId,
				organizationSlug: input.organizationSlug,
				enabled: notificationsEnabled,
				computer: {
					available: Boolean(computer?.destination),
					statusLabel: computer?.statusLabel ?? "Checking…",
					statusTone: trayComputerStatusTone,
				},
				inboxRefreshRevision: itemsQuery.data?.cursor
					? itemsQuery.dataUpdatedAt
					: undefined,
				latestUnreadStatus,
				navigationKey,
				unreadCount,
				unreadCountStatus,
				visibleConversation,
			})
			.catch(reportFailure);
	}, [
		input.userId,
		input.organizationId,
		input.organizationSlug,
		computer?.destination,
		computer?.statusLabel,
		trayComputerStatusTone,
		desktop,
		latestUnreadStatus,
		itemsQuery.data?.cursor,
		notificationsEnabled,
		attention,
		unreadCount,
		unreadCountStatus,
		visibleConversation,
		navigationKey,
	]);
	useLayoutEffect(
		() => () => {
			getDesktopPlatform()
				?.setNotificationContext(null)
				.catch((error: unknown) =>
					console.warn("[openmeld.desktop.notification_context_failed]", {
						error,
					})
				);
		},
		[]
	);
	const [observedItemIds] = useState(() => new Set<string>());
	const [settledItemIds] = useState(() => new Set<string>());
	const [inFlightItemIds] = useState(() => new Set<string>());
	const [deliveryRetryRevision, setDeliveryRetryRevision] = useState(0);
	const [recoveredPendingItemsState, setRecoveredPendingItemsState] = useState<{
		feedIdentity: string | null;
		items: NotificationInboxItem[];
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
	const deliveryContextRef = useRef<NotificationDeliveryContext>({
		enabled: notificationsEnabled,
		feedIdentity,
		itemsById: new Map(),
		organizationId: input.organizationId,
		organizationSlug: input.organizationSlug,
		pathname,
		userId: input.userId,
		visibleConversation,
	});
	const streamConnectedRef = useRef(streamConnected);
	useLayoutEffect(() => {
		streamConnectedRef.current = streamConnected;
	}, [streamConnected]);
	const lastNativePollAtRef = useRef(0);
	useEffect(
		() =>
			desktop?.onNotificationPoll(() => {
				// Push already refreshes the feed while the stream is connected, so
				// the native cadence only repairs missed frames on the recovery
				// interval. Without push it keeps the hidden-window tray and native
				// notifications current.
				const now = Date.now();
				if (
					streamConnectedRef.current &&
					now - lastNativePollAtRef.current <
						CONNECTED_INBOX_RECOVERY_POLL_INTERVAL_MS
				) {
					return;
				}
				lastNativePollAtRef.current = now;
				summaryQuery.refetch({ cancelRefetch: false }).catch((error: unknown) =>
					console.warn("[openmeld.desktop.inbox_summary_refresh_failed]", {
						error,
					})
				);
				itemsQuery.refetch({ cancelRefetch: false }).catch((error: unknown) =>
					console.warn("[openmeld.desktop.notification_refresh_failed]", {
						error,
					})
				);
				setDeliveryRetryRevision((current) => current + 1);
			}),
		[desktop, itemsQuery.refetch, summaryQuery.refetch]
	);
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
		}, INBOX_NOTIFICATION_RETRY_INTERVAL_MS);
	}, [cancelDeliveryRetry, feedIdentity]);

	useEffect(() => {
		const ownedFeedIdentity = feedIdentity;
		return () => cancelDeliveryRetry(ownedFeedIdentity);
	}, [cancelDeliveryRetry, feedIdentity]);

	useEffect(() => {
		const refresh = (retryDelivery: boolean) => {
			const enabled = readInboxNotificationSettings({
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
		return subscribeInboxNotificationSettings(() => refresh(true));
	}, [input.userId]);

	useLayoutEffect(() => {
		const listedItems = itemsQuery.data?.items ?? [];
		const items = mergeInboxNotificationItems({
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
			visibleConversation,
		};
		return () => {
			if (deliveryContextRef.current.feedIdentity !== feedIdentity) {
				return;
			}
			deliveryContextRef.current =
				createInactiveInboxNotificationDeliveryContext();
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
		visibleConversation,
	]);

	useEffect(() => {
		if (!(notificationsEnabled && itemsQuery.data)) {
			return;
		}
		const listedItems = itemsQuery.data.items;
		const availableItemIds = new Set(listedItems.map((item) => item.id));
		const missingPendingItemIds = [
			...readPendingInboxNotificationItemIds({
				organizationId: input.organizationId,
				userId: input.userId,
			}),
		].filter((itemId) => !availableItemIds.has(itemId));
		if (missingPendingItemIds.length === 0) {
			return;
		}
		let cancelled = false;
		const recoverPendingItems = async () => {
			const recoveredItems: NotificationInboxItem[] = [];
			for (
				let offset = 0;
				offset < missingPendingItemIds.length;
				offset += INBOX_NOTIFICATION_PENDING_FETCH_CONCURRENCY
			) {
				if (cancelled) {
					return;
				}
				const batch = missingPendingItemIds.slice(
					offset,
					offset + INBOX_NOTIFICATION_PENDING_FETCH_CONCURRENCY
				);
				const batchItems = await Promise.all(
					batch.map((itemId) =>
						readPendingInboxNotificationItem({
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
						(item): item is NotificationInboxItem => item !== null
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
		if (!itemsQuery.data) {
			return;
		}
		const currentItems = mergeInboxNotificationItems({
			listedItems: itemsQuery.data.items,
			recoveredPendingItems,
		});
		if (!primedRef.current) {
			if (notificationsEnabled) {
				primeInboxNotificationFeed({
					items: currentItems,
					observedItemIds,
					organizationId: input.organizationId,
					pendingItemIds: readPendingInboxNotificationItemIds({
						organizationId: input.organizationId,
						userId: input.userId,
					}),
					settledItemIds,
					userId: input.userId,
				});
			} else {
				markObservedInboxItems(currentItems, observedItemIds);
			}
			primedRef.current = true;
		}
		const sawNewSpaceMessage = currentItems.some(
			(item) => item.kind === "space_message" && !observedItemIds.has(item.id)
		);
		let sawNewItem = false;
		if (notificationsEnabled) {
			sawNewItem = processInboxNotificationItems({
				signal: deliveryAbortRef.current?.controller.signal,
				navigate,
				deliveryAttempt: deliveryRetryRevision,
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
				visibleConversation,
			});
		} else {
			sawNewItem = markObservedInboxItems(currentItems, observedItemIds);
		}
		if (sawNewSpaceMessage) {
			// The Inbox item is only a refresh signal. Read the current Space
			// directory so its preview catches up when a notification arrives.
			queryClient
				.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
					predicate: (query) =>
						query.queryKey[3] === "account" || query.queryKey[3] === "profile",
				})
				.catch((error: unknown) => {
					console.warn("[openmeld.web.space.directory_refresh_failed]", {
						error: error instanceof Error ? error.message : String(error),
					});
				});
		}
		if (sawNewItem) {
			invalidateInboxFacts({
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
		visibleConversation,
		navigate,
	]);

	return null;
}

type NotificationInboxItem = Parameters<typeof isInboxNotificationEligible>[0];

function markObservedInboxItems(
	items: readonly NotificationInboxItem[],
	observedItemIds: Set<string>
): boolean {
	let sawNewItem = false;
	for (const item of items) {
		if (!observedItemIds.has(item.id)) {
			observedItemIds.add(item.id);
			sawNewItem = true;
		}
	}
	return sawNewItem;
}

type NotificationDeliveryContext = {
	enabled: boolean;
	feedIdentity: string | null;
	itemsById: Map<string, NotificationInboxItem>;
	organizationId: string;
	organizationSlug: string;
	pathname: string | null;
	userId: string;
	visibleConversation: ReturnType<typeof useInboxVisibleConversation>;
};

function createInactiveInboxNotificationDeliveryContext(): NotificationDeliveryContext {
	return {
		enabled: false,
		feedIdentity: null,
		itemsById: new Map(),
		organizationId: "",
		organizationSlug: "",
		pathname: null,
		userId: "",
		visibleConversation: null,
	};
}

async function readPendingInboxNotificationItem(input: {
	isCancelled: () => boolean;
	itemId: string;
	organizationId: string;
	queryClient: QueryClient;
	retryAttempt: number;
	scheduleDeliveryRetry: () => void;
	userId: string;
}): Promise<NotificationInboxItem | null> {
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
			clearInboxNotificationItemPending({
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

function primeInboxNotificationFeed(input: {
	items: readonly NotificationInboxItem[];
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
			shouldDeliverInboxNotification(item)
		) {
			continue;
		}
		input.settledItemIds.add(item.id);
		if (input.pendingItemIds.has(item.id)) {
			clearInboxNotificationItemPending({
				itemId: item.id,
				organizationId: input.organizationId,
				userId: input.userId,
			});
		}
	}
}

function processInboxNotificationItems(input: {
	signal?: AbortSignal;
	navigate: ReturnType<typeof useNavigate>;
	deliveryAttempt: number;
	deliveryContextRef: {
		current: NotificationDeliveryContext;
	};
	feedIdentity: string;
	inFlightItemIds: Set<string>;
	items: readonly NotificationInboxItem[];
	observedItemIds: Set<string>;
	organizationId: string;
	organizationSlug: string;
	pathname: string | null;
	scheduleDeliveryRetry: () => void;
	settledItemIds: Set<string>;
	userId: string;
	visibleConversation: ReturnType<typeof useInboxVisibleConversation>;
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
		if (!shouldDeliverInboxNotification(item)) {
			input.settledItemIds.add(item.id);
			clearInboxNotificationItemPending({
				itemId: item.id,
				organizationId: input.organizationId,
				userId: input.userId,
			});
			continue;
		}
		if (
			!markInboxNotificationItemPending({
				itemId: item.id,
				organizationId: input.organizationId,
				userId: input.userId,
			})
		) {
			input.scheduleDeliveryRetry();
			continue;
		}
		input.inFlightItemIds.add(item.id);
		const isCurrentFeed = () =>
			input.deliveryContextRef.current.feedIdentity === input.feedIdentity;
		showInboxNotification({
			signal: input.signal,
			item,
			organizationId: input.organizationId,
			onActivate: (currentItem) => {
				if (input.deliveryContextRef.current.userId !== input.userId) {
					return;
				}
				const navigation = buildInboxItemSourceNavigation({
					item: currentItem,
					orgSlug: input.organizationSlug,
				});
				if (navigation.openInNewTab) {
					window.open(navigation.href, "_blank", "noopener,noreferrer");
				} else {
					input
						.navigate({
							to: navigation.href,
							state: requestInboxSourceFocus,
						})
						.catch((error: unknown) =>
							console.warn("[openmeld.web.notification_navigation_failed]", {
								error,
							})
						);
				}
			},
			organizationSlug: input.organizationSlug,
			resolveCurrentReadiness: async () =>
				await resolveCurrentInboxNotificationReadiness({
					deliveryContextRef: input.deliveryContextRef,
					feedIdentity: input.feedIdentity,
					itemId: item.id,
					organizationId: input.organizationId,
					retryAttempt: input.deliveryAttempt,
					userId: input.userId,
				}),
			userId: input.userId,
			viewingSourceSession: isInboxItemSourceLocation({
				item,
				orgSlug: input.organizationSlug,
				pathname: input.pathname,
				visibleConversation: input.visibleConversation,
			}),
		})
			.then((result) => {
				handleInboxNotificationDeliveryResult({
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

async function resolveCurrentInboxNotificationReadiness(input: {
	deliveryContextRef: { current: NotificationDeliveryContext };
	feedIdentity: string;
	itemId: string;
	organizationId: string;
	retryAttempt: number;
	userId: string;
}): Promise<InboxNotificationDeliveryReadiness> {
	if (!isCurrentInboxNotificationDeliveryContext(input)) {
		return { status: "context_changed" };
	}

	let currentItem: NotificationInboxItem;
	try {
		// This request runs after the cross-tab delivery lock is acquired. Calling
		// Core directly guarantees it cannot be joined to an older in-flight Query
		// request with the same item key.
		const response = await getCurrentInboxItem({
			itemId: input.itemId,
			organizationId: input.organizationId,
		});
		currentItem = response.item;
	} catch (error) {
		if (isInboxItemNotFoundFailure(error)) {
			return { status: "ineligible" };
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
		return { status: "revalidation_failed" };
	}

	try {
		const spaceId = inboxMessageNotificationSpaceId(currentItem);
		if (spaceId) {
			const preferences = await getCurrentInboxMessageNotificationPreferences({
				organizationId: input.organizationId,
				spaceId,
			});
			if (
				!isInboxNotificationEligible(currentItem, preferences.effectiveMode)
			) {
				return { status: "ineligible" };
			}
		}
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "inbox.conversation_not_found"
		) {
			return { status: "ineligible" };
		}
		console.warn(
			"[openmeld.web.inbox.message_notification_preference_read_failed]",
			{
				error: error instanceof Error ? error.message : String(error),
				itemId: input.itemId,
				organizationId: input.organizationId,
			}
		);
		return { status: "revalidation_failed" };
	}

	if (!isCurrentInboxNotificationDeliveryContext(input)) {
		return { status: "context_changed" };
	}
	const current = input.deliveryContextRef.current;
	if (
		currentItem.id !== input.itemId ||
		currentItem.recipientUserId !== current.userId ||
		!isInboxItemInOrganizationScope(currentItem, current.organizationId) ||
		!shouldDeliverInboxNotification(currentItem)
	) {
		return { status: "ineligible" };
	}
	if (
		(await isNotificationConversationVisible()) &&
		isInboxItemSourceLocation({
			item: currentItem,
			orgSlug: current.organizationSlug,
			pathname: current.pathname,
			visibleConversation: current.visibleConversation,
		})
	) {
		return { status: "source_visible" };
	}
	return { item: currentItem, status: "eligible" };
}

function isCurrentInboxNotificationDeliveryContext(input: {
	deliveryContextRef: { current: NotificationDeliveryContext };
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

function handleInboxNotificationDeliveryResult(input: {
	deliveryContextRef: { current: NotificationDeliveryContext };
	feedIdentity: string;
	item: NotificationInboxItem;
	organizationId: string;
	result: Awaited<ReturnType<typeof showInboxNotification>>;
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
				(!isInboxItemInOrganizationScope(currentItem, current.organizationId) ||
					currentItem.recipientUserId !== current.userId ||
					!shouldDeliverInboxNotification(currentItem))
			) {
				clearPendingInboxNotificationItem({ ...input, settle: true });
				return;
			}
		}
		input.scheduleDeliveryRetry();
		return;
	}

	clearPendingInboxNotificationItem({
		...input,
		settle: current.feedIdentity === input.feedIdentity,
	});
}

function clearPendingInboxNotificationItem(input: {
	item: NotificationInboxItem;
	organizationId: string;
	settle: boolean;
	settledItemIds: Set<string>;
	userId: string;
}): void {
	clearInboxNotificationItemPending({
		itemId: input.item.id,
		organizationId: input.organizationId,
		userId: input.userId,
	});
	if (input.settle) {
		input.settledItemIds.add(input.item.id);
	}
}

function shouldDeliverInboxNotification(item: NotificationInboxItem): boolean {
	return (
		item.readAt === null && isInboxNotificationEligible(item, "all_messages")
	);
}

function mergeInboxNotificationItems(input: {
	listedItems: readonly NotificationInboxItem[];
	recoveredPendingItems: readonly NotificationInboxItem[];
}): NotificationInboxItem[] {
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
