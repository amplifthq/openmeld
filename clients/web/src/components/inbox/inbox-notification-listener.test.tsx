import type { InboxItem } from "@openmeld/schemas/types";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: Spy on the owned transport boundary, while retaining its default implementation in other cases.
import * as accountStream from "#/lib/inbox/account-invalidation-transport";
import { requestInboxSourceFocus } from "#/lib/inbox/source-focus-request";
import { InboxNotificationListener } from "./inbox-notification-listener";

const itemsQueryMock = vi.hoisted(() => vi.fn());
const itemsRefetch = vi.hoisted(() => vi.fn(async () => undefined));
const summaryRefetch = vi.hoisted(() => vi.fn(async () => undefined));
const summaryQueryMock = vi.hoisted(() => vi.fn());
const desktopPlatformMock = vi.hoisted(() => vi.fn());
const currentComputerMock = vi.hoisted(() => vi.fn());
vi.mock("#/components/app/current-computer", () => ({
	useCurrentComputer: currentComputerMock,
}));
vi.mock("#/desktop/platform", () => ({
	getDesktopPlatform: desktopPlatformMock,
}));
vi.mock("#/desktop/updater", () => ({
	useDesktopUpdater: () => ({ status: "idle" }),
}));
const usePathnameMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const showInboxNotificationMock = vi.hoisted(() => vi.fn());
const invalidateInboxFactsMock = vi.hoisted(() => vi.fn());
const getCurrentInboxItemMock = vi.hoisted(() => vi.fn());
const getMessagePreferencesMock = vi.hoisted(() => vi.fn());
const queryClientMock = vi.hoisted(() => ({
	fetchQuery: vi.fn(),
	invalidateQueries: vi.fn(
		async (_filters?: {
			queryKey?: readonly unknown[];
			predicate?: (query: { queryKey: readonly string[] }) => boolean;
		}) => undefined
	),
}));
const pendingItemIds = vi.hoisted(() => new Set<string>());
const notificationSettingsByUserId = vi.hoisted(
	() => new Map<string, boolean>()
);
const notificationSettingsSubscription = vi.hoisted(() => ({
	onChange: null as (() => void) | null,
}));

type TestDeliveryReadiness = {
	item?: InboxItem;
	status: string;
};

type TestDeliveryInput = {
	resolveCurrentReadiness?: () =>
		| TestDeliveryReadiness
		| Promise<TestDeliveryReadiness>;
};

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
	useLocation: () => ({ pathname: usePathnameMock() }),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: (options: { queryKey?: readonly unknown[] }) =>
		options.queryKey?.includes("notification-observations")
			? itemsQueryMock(options)
			: summaryQueryMock(options),
	useQueryClient: () => queryClientMock,
}));

vi.mock("#/lib/inbox/client-notifications", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("#/lib/inbox/client-notifications")
	>()),
	clearInboxNotificationItemPending: (input: {
		itemId: string;
		organizationId: string;
		userId: string;
	}) => {
		pendingItemIds.delete(buildPendingItemKey(input));
	},
	markInboxNotificationItemPending: (input: {
		itemId: string;
		organizationId: string;
		userId: string;
	}) => {
		pendingItemIds.add(buildPendingItemKey(input));
		return true;
	},
	readPendingInboxNotificationItemIds: (input: {
		organizationId: string;
		userId: string;
	}) => {
		const prefix = `${input.organizationId}:${input.userId}:`;
		return new Set(
			[...pendingItemIds]
				.filter((key) => key.startsWith(prefix))
				.map((key) => key.slice(prefix.length))
		);
	},
	readInboxNotificationSettings: (input: { userId: string }) => ({
		enabled: notificationSettingsByUserId.get(input.userId) ?? true,
		permission: "granted",
		soundEnabled: true,
	}),
	showInboxNotification: showInboxNotificationMock,
	subscribeInboxNotificationSettings: (onChange: () => void) => {
		notificationSettingsSubscription.onChange = onChange;
		return () => {
			notificationSettingsSubscription.onChange = null;
		};
	},
}));

vi.mock("#/lib/inbox/source-target", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("#/lib/inbox/source-target")>();
	return {
		...original,
		isInboxItemSourceLocation: (input: {
			item: InboxItem;
			pathname: string | null;
		}) =>
			input.pathname?.includes(
				(input.item.sourceTarget as { spaceId?: string }).spaceId ?? "\u0000"
			),
	};
});

vi.mock("#/lib/organizations/inbox", () => ({
	getCurrentInboxItem: getCurrentInboxItemMock,
	getCurrentInboxMessageNotificationPreferences: getMessagePreferencesMock,
}));

vi.mock("#/query/organizations/inbox", () => ({
	inboxBrowserNotificationRecoveryItemQueryOptions: (input: unknown) => ({
		...(input as object),
		staleTime: 0,
	}),
	inboxQueryKeys: { organization: (id: string) => ["inbox", id] },
	inboxSummaryQueryOptions: (input: unknown) => input,
	invalidateInboxFacts: invalidateInboxFactsMock,
}));

describe("InboxNotificationListener", () => {
	let currentItems: InboxItem[];
	let itemsDataUpdatedAt: number;
	let itemsCursor: string;
	let queryDataItems: InboxItem[] | null;
	let queryDataCursor: string | null;
	let queryData:
		| {
				items: InboxItem[];
				cursor: string;
				hasMore: boolean;
				organizationId: string;
		  }
		| undefined;

	beforeEach(() => {
		navigateMock.mockReset().mockResolvedValue(undefined);
		desktopPlatformMock.mockReset().mockReturnValue(null);
		currentComputerMock.mockReset().mockReturnValue(null);
		vi.spyOn(document, "hasFocus").mockReturnValue(true);
		summaryRefetch.mockClear();
		summaryQueryMock.mockReset().mockReturnValue({
			data: undefined,
			isError: false,
			isPending: true,
			refetch: summaryRefetch,
		});
		getMessagePreferencesMock
			.mockReset()
			.mockResolvedValue({ effectiveMode: "mentions_and_replies" });
		currentItems = [];
		itemsDataUpdatedAt = 1;
		itemsCursor = "test-position";
		queryDataItems = null;
		queryDataCursor = null;
		queryData = undefined;
		pendingItemIds.clear();
		notificationSettingsByUserId.clear();
		notificationSettingsSubscription.onChange = null;
		showInboxNotificationMock
			.mockReset()
			.mockResolvedValue({ notification: {}, status: "delivered" });
		invalidateInboxFactsMock.mockReset().mockResolvedValue(undefined);
		queryClientMock.fetchQuery.mockReset();
		queryClientMock.invalidateQueries.mockClear();
		getCurrentInboxItemMock.mockReset();
		itemsRefetch.mockClear();
		usePathnameMock.mockReset().mockReturnValue("/o/amplift/home");
		itemsQueryMock.mockReset().mockImplementation(() => {
			if (queryDataItems !== currentItems || queryDataCursor !== itemsCursor) {
				queryDataItems = currentItems;
				queryDataCursor = itemsCursor;
				queryData = {
					items: currentItems,
					cursor: itemsCursor,
					hasMore: false,
					organizationId: "organization-123",
				};
			}
			return {
				data: queryData,
				dataUpdatedAt: itemsDataUpdatedAt,
				refetch: itemsRefetch,
			};
		});
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("navigates the native authorized target without reading the Inbox item again", () => {
		let click:
			| ((
					input: import("@openmeld/schemas").DesktopNotificationActivation
			  ) => void)
			| undefined;
		desktopPlatformMock.mockReturnValue({
			setNotificationContext: vi.fn(async () => undefined),
			onNotificationPoll: () => () => undefined,
			onNotificationClick: (handler: typeof click) => {
				click = handler;
				return () => undefined;
			},
		});
		renderListener();
		const activation = {
			userId: "user-123",
			organizationId: "organization-123",
			organizationSlug: "amplift",
			itemId: "item-123",
			sourceTarget: {
				kind: "space" as const,
				spaceId: "space-123",
				signalId: "reply",
				threadRootSignalId: "root",
			},
		};
		click?.(activation);
		expect(navigateMock).toHaveBeenCalledExactlyOnceWith({
			state: requestInboxSourceFocus,
			to: "/o/amplift/spaces/space-123?focusSignalId=reply&focusThreadRootSignalId=root",
		});
		expect(getCurrentInboxItemMock).not.toHaveBeenCalled();
		click?.(activation);
		expect(navigateMock).toHaveBeenCalledTimes(2);
		const firstState = requestInboxSourceFocus({});
		const secondState = requestInboxSourceFocus(firstState);
		expect(secondState.inboxSourceFocusRequestId).not.toBe(
			firstState.inboxSourceFocusRequestId
		);
		click?.({ ...activation, userId: "another-user" });
		expect(navigateMock).toHaveBeenCalledTimes(2);
	});

	it.each([
		{ total: 7, error: false, expected: 7, expectedStatus: "ready" },
		{ total: 0, error: false, expected: 0, expectedStatus: "ready" },
		{
			total: 7,
			error: true,
			expected: null,
			expectedStatus: "unavailable",
		},
		{
			total: undefined,
			error: false,
			expected: null,
			expectedStatus: "loading",
		},
	])("projects unread $total (error=$error) and refreshes with notifications off", ({
		total,
		error,
		expected,
		expectedStatus,
	}) => {
		const setNotificationContext = vi.fn(
			async (_context: unknown) => undefined
		);
		let poll: (() => void) | undefined;
		desktopPlatformMock.mockReturnValue({
			setNotificationContext,
			onNotificationClick: () => () => undefined,
			onNotificationPoll: (listener: () => void) => {
				poll = listener;
				return () => undefined;
			},
		});
		notificationSettingsByUserId.set("user-123", false);
		summaryQueryMock.mockReturnValue({
			data:
				total === undefined
					? undefined
					: {
							totalUnreadCount: total,
							ordinaryUnreadCount: total,
							unreadMentionCount: 1,
							unreadUrgentUpdateCount: 0,
							unresolvedActionCount: 2,
						},
			isError: error,
			isPending: total === undefined,
			refetch: summaryRefetch,
		});
		const view = renderListener();
		const context = setNotificationContext.mock.lastCall?.[0] as
			| { attention?: unknown }
			| null
			| undefined;
		expect(context).toEqual(
			expect.objectContaining({
				userId: "user-123",
				organizationId: "organization-123",
				enabled: false,
				unreadCount: expected,
				unreadCountStatus: expectedStatus,
			})
		);
		expect(context?.attention !== null).toBe(expected !== null);
		act(() => poll?.());
		expect(summaryRefetch).toHaveBeenCalledOnce();
		expect(showInboxNotificationMock).not.toHaveBeenCalled();
		view.unmount();
		expect(setNotificationContext).toHaveBeenLastCalledWith(null);
	});

	it.each([
		{
			name: "connected",
			statusLabel: "Connected",
			reason: "ready",
			expectedTone: "connected",
		},
		{
			name: "offline",
			statusLabel: "Not connected",
			reason: null,
			expectedTone: "offline",
		},
		{
			name: "disconnected",
			statusLabel: "Disconnected",
			reason: "service_not_connected",
			expectedTone: "offline",
		},
		{
			name: "needs attention",
			statusLabel: "Checking OpenMeld status",
			reason: "checking",
			expectedTone: "attention",
		},
	])("passes $name Computer tone to the native tray", ({
		statusLabel,
		reason,
		expectedTone,
	}) => {
		const setNotificationContext = vi.fn(
			async (_context: unknown) => undefined
		);
		desktopPlatformMock.mockReturnValue({
			setNotificationContext,
			onNotificationClick: () => () => undefined,
			onNotificationPoll: () => () => undefined,
		});
		currentComputerMock.mockReturnValue({
			destination: "/o/amplift/computers",
			status: reason ? { reason } : null,
			statusLabel,
		});
		renderListener();
		expect(setNotificationContext).toHaveBeenCalledWith(
			expect.objectContaining({
				computer: {
					available: true,
					statusLabel,
					statusTone: expectedTone,
				},
			})
		);
	});

	it("refreshes the native preview when Inbox content changes without changing the unread count", () => {
		const setNotificationContext = vi.fn(async () => undefined);
		desktopPlatformMock.mockReturnValue({
			setNotificationContext,
			onNotificationClick: () => () => undefined,
			onNotificationPoll: () => () => undefined,
		});
		summaryQueryMock.mockReturnValue({
			data: {
				totalUnreadCount: 5,
				unreadUrgentUpdateCount: 0,
				unresolvedActionCount: 0,
			},
			isError: false,
			isPending: false,
			refetch: summaryRefetch,
		});
		const view = renderListener();
		const initialCalls = setNotificationContext.mock.calls.length;

		itemsDataUpdatedAt = 2;
		itemsCursor = "next-position";
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		expect(setNotificationContext).toHaveBeenCalledTimes(initialCalls + 1);
		expect(setNotificationContext).toHaveBeenLastCalledWith(
			expect.objectContaining({ unreadCount: 5 })
		);
	});

	it("primes existing items, ignores delayed legacy owner observations and delivers a new urgent item", () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const newItem = createInboxItem({
			id: "new-item",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();

		expect(showInboxNotificationMock).not.toHaveBeenCalled();
		const legacyOwner = createInboxItem({
			id: "delayed-owner-outbox",
			kind: "space_message",
			attention: "update",
			importance: "normal",
			resolutionStatus: "not_applicable",
			sourceTarget: {
				kind: "space",
				spaceId: "space-123",
				signalId: "legacy",
				directMessage: true,
				agentOwnerActivity: true,
			},
		});
		currentItems = [legacyOwner, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		expect(showInboxNotificationMock).not.toHaveBeenCalled();
		currentItems = [newItem, legacyOwner, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		expect(showInboxNotificationMock).toHaveBeenCalledOnce();
		expect(invalidateInboxFactsMock).toHaveBeenCalledWith({
			organizationId: "organization-123",
			queryClient: queryClientMock,
		});
		expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith(
			expect.objectContaining({ queryKey: ["spaces", "account-spaces"] })
		);
		expect(showInboxNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				item: newItem,
				userId: "user-123",
			})
		);
		showInboxNotificationMock.mock.calls[0]?.[0].onActivate(newItem);
		expect(navigateMock).toHaveBeenCalledExactlyOnceWith({
			state: requestInboxSourceFocus,
			to: "/o/amplift/spaces/space-123?focusSignalId=signal-123",
		});
	});

	it("retries a new item after current-conversation suppression no longer applies", async () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const newItem = createInboxItem({
			id: "retry-after-source-suppression",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();
		showInboxNotificationMock
			.mockResolvedValueOnce({
				reason: "source_visible",
				status: "deferred",
			})
			.mockResolvedValueOnce({ notification: {}, status: "delivered" });

		currentItems = [newItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await waitFor(() => {
			expect(showInboxNotificationMock).toHaveBeenCalledOnce();
		});

		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		act(() => notificationSettingsSubscription.onChange?.());

		await waitFor(() => {
			expect(showInboxNotificationMock).toHaveBeenCalledTimes(2);
		});
	});

	it("retries a new item after notification delivery throws", async () => {
		vi.useFakeTimers();
		const existingItem = createInboxItem({ id: "existing-item" });
		const newItem = createInboxItem({
			id: "retry-after-delivery-failure",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();
		showInboxNotificationMock
			.mockRejectedValueOnce(new Error("Notification constructor failed"))
			.mockResolvedValueOnce({ notification: {}, status: "delivered" });
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		currentItems = [newItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(showInboxNotificationMock).toHaveBeenCalledOnce();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(showInboxNotificationMock).toHaveBeenCalledTimes(2);
	});

	it.each([
		"claim_failed",
		"permission_unavailable",
	] as const)("retries a deferred %s delivery without waiting for query data to change", async (reason) => {
		vi.useFakeTimers();
		const existingItem = createInboxItem({ id: "existing-item" });
		const newItem = createInboxItem({
			id: `retry-after-${reason}`,
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();
		showInboxNotificationMock
			.mockResolvedValueOnce({
				reason,
				status: "deferred",
			})
			.mockResolvedValueOnce({ notification: {}, status: "delivered" });

		currentItems = [newItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(showInboxNotificationMock).toHaveBeenCalledOnce();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(showInboxNotificationMock).toHaveBeenCalledTimes(2);
	});

	it("retries a pending delivery after the listener remounts", async () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const pendingItem = createInboxItem({
			id: "retry-after-remount",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();
		showInboxNotificationMock.mockRejectedValueOnce(
			new Error("Notification constructor failed")
		);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		currentItems = [pendingItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await waitFor(() => {
			expect(hasPendingItem(pendingItem.id)).toBe(true);
		});
		view.unmount();
		showInboxNotificationMock.mockResolvedValueOnce({
			notification: {},
			status: "delivered",
		});

		renderListener();
		await waitFor(() => {
			expect(showInboxNotificationMock).toHaveBeenCalledTimes(2);
			expect(hasPendingItem(pendingItem.id)).toBe(false);
		});
	});

	it("recovers a pending item that is no longer in the first Inbox page", async () => {
		const firstPageItem = createInboxItem({ id: "first-page-item" });
		const pendingItem = createInboxItem({
			id: "pending-outside-first-page",
			importance: "urgent",
		});
		pendingItemIds.add(
			buildPendingItemKey({
				itemId: pendingItem.id,
				organizationId: "organization-123",
				userId: "user-123",
			})
		);
		currentItems = [firstPageItem];
		queryClientMock.fetchQuery.mockResolvedValue({ item: pendingItem });

		renderListener();

		await waitFor(() => {
			expect(queryClientMock.fetchQuery).toHaveBeenCalledWith(
				expect.objectContaining({ itemId: pendingItem.id })
			);
			expect(showInboxNotificationMock).toHaveBeenCalledWith(
				expect.objectContaining({ item: pendingItem })
			);
			expect(hasPendingItem(pendingItem.id)).toBe(false);
		});
	});

	it("prefers a newer listed item over its recovered pending copy", async () => {
		const recoveredItem = createInboxItem({
			id: "recovered-then-resolved",
			importance: "urgent",
		});
		pendingItemIds.add(
			buildPendingItemKey({
				itemId: recoveredItem.id,
				organizationId: "organization-123",
				userId: "user-123",
			})
		);
		currentItems = [createInboxItem({ id: "first-page-item" })];
		queryClientMock.fetchQuery.mockResolvedValue({ item: recoveredItem });
		let queuedInput: TestDeliveryInput | undefined;
		let resolveQueued: ((value: unknown) => void) | undefined;
		showInboxNotificationMock.mockImplementationOnce(
			(input: TestDeliveryInput) => {
				queuedInput = input;
				return new Promise((resolve) => {
					resolveQueued = resolve;
				});
			}
		);
		const view = renderListener();
		await waitFor(() => expect(queuedInput).toBeDefined());

		const resolvedItem = createInboxItem({
			...recoveredItem,
			readAt: "2026-08-04T01:01:00.000Z",
			resolutionStatus: "resolved",
		});
		currentItems = [resolvedItem];
		getCurrentInboxItemMock.mockResolvedValue({ item: resolvedItem });
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		await expect(queuedInput?.resolveCurrentReadiness?.()).resolves.toEqual({
			status: "ineligible",
		});
		await act(async () => {
			resolveQueued?.({ status: "ineligible" });
			await Promise.resolve();
		});
		await waitFor(() => {
			expect(hasPendingItem(recoveredItem.id)).toBe(false);
		});
		expect(showInboxNotificationMock).toHaveBeenCalledOnce();
	});

	it("revalidates a listed item against Core immediately before delivery", async () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const queuedItem = createInboxItem({
			id: "resolved-before-delivery",
			importance: "urgent",
		});
		const resolvedItem = createInboxItem({
			...queuedItem,
			readAt: "2026-08-04T01:01:00.000Z",
			resolutionStatus: "resolved",
		});
		currentItems = [existingItem];
		const view = renderListener();
		getCurrentInboxItemMock.mockResolvedValue({ item: resolvedItem });
		let currentReadiness: TestDeliveryReadiness | undefined;
		showInboxNotificationMock.mockImplementationOnce(
			async (input: TestDeliveryInput) => {
				currentReadiness = await input.resolveCurrentReadiness?.();
				return currentReadiness?.status === "ineligible"
					? { status: "ineligible" }
					: { reason: "revalidation_failed", status: "deferred" };
			}
		);

		currentItems = [queuedItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		await waitFor(() => {
			expect(currentReadiness).toEqual({ status: "ineligible" });
			expect(getCurrentInboxItemMock).toHaveBeenCalledWith({
				itemId: queuedItem.id,
				organizationId: "organization-123",
			});
			expect(hasPendingItem(queuedItem.id)).toBe(false);
		});
	});

	it("returns the fresh eligible Core item after the delivery lock", async () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const queuedItem = createInboxItem({
			id: "updated-before-delivery",
			importance: "urgent",
			preview: "Old preview",
		});
		const freshItem = createInboxItem({
			...queuedItem,
			importance: "normal",
			kind: "agent_reply",
			preview: "Fresh preview",
			resolutionStatus: "not_applicable",
			title: "Fresh title",
		});
		currentItems = [existingItem];
		const view = renderListener();
		getCurrentInboxItemMock.mockResolvedValue({ item: freshItem });
		let currentReadiness: TestDeliveryReadiness | undefined;
		showInboxNotificationMock.mockImplementationOnce(
			async (input: TestDeliveryInput) => {
				currentReadiness = await input.resolveCurrentReadiness?.();
				return { notification: {}, status: "delivered" };
			}
		);

		currentItems = [queuedItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		await waitFor(() => {
			expect(currentReadiness).toEqual({
				item: freshItem,
				status: "eligible",
			});
			expect(getCurrentInboxItemMock).toHaveBeenCalledOnce();
			expect(queryClientMock.fetchQuery).not.toHaveBeenCalled();
		});
	});

	it("clears an off-page pending item that no longer exists", async () => {
		const missingItemId = "missing-off-page-item";
		pendingItemIds.add(
			buildPendingItemKey({
				itemId: missingItemId,
				organizationId: "organization-123",
				userId: "user-123",
			})
		);
		currentItems = [createInboxItem({ id: "first-page-item" })];
		queryClientMock.fetchQuery.mockRejectedValue({ status: 404 });

		renderListener();

		await waitFor(() => {
			expect(hasPendingItem(missingItemId)).toBe(false);
		});
		expect(showInboxNotificationMock).not.toHaveBeenCalled();
	});

	it("clears an off-page pending item that is no longer eligible", async () => {
		const resolvedItem = createInboxItem({
			id: "resolved-off-page-item",
			importance: "urgent",
			resolutionStatus: "resolved",
		});
		pendingItemIds.add(
			buildPendingItemKey({
				itemId: resolvedItem.id,
				organizationId: "organization-123",
				userId: "user-123",
			})
		);
		currentItems = [createInboxItem({ id: "first-page-item" })];
		queryClientMock.fetchQuery.mockResolvedValue({ item: resolvedItem });

		renderListener();

		await waitFor(() => {
			expect(hasPendingItem(resolvedItem.id)).toBe(false);
		});
		expect(showInboxNotificationMock).not.toHaveBeenCalled();
	});

	it("revalidates a recovered off-page item before retrying it", async () => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		usePathnameMock.mockReturnValue("/o/amplift/spaces/space-123");
		const pendingItem = createInboxItem({
			id: "revalidated-off-page-item",
			importance: "urgent",
		});
		const resolvedItem = createInboxItem({
			...pendingItem,
			readAt: "2026-08-04T01:01:00.000Z",
			resolutionStatus: "resolved",
		});
		pendingItemIds.add(
			buildPendingItemKey({
				itemId: pendingItem.id,
				organizationId: "organization-123",
				userId: "user-123",
			})
		);
		currentItems = [createInboxItem({ id: "first-page-item" })];
		queryClientMock.fetchQuery
			.mockResolvedValueOnce({ item: pendingItem })
			.mockResolvedValue({ item: resolvedItem });
		showInboxNotificationMock.mockResolvedValueOnce({
			reason: "source_visible",
			status: "deferred",
		});

		renderListener();
		await waitFor(() => {
			expect(showInboxNotificationMock).toHaveBeenCalledOnce();
			expect(hasPendingItem(pendingItem.id)).toBe(true);
		});

		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		act(() => notificationSettingsSubscription.onChange?.());

		await waitFor(() => {
			expect(queryClientMock.fetchQuery).toHaveBeenCalledTimes(2);
			expect(hasPendingItem(pendingItem.id)).toBe(false);
		});
		expect(showInboxNotificationMock).toHaveBeenCalledOnce();
	});

	it("retries a temporary off-page pending item read failure", async () => {
		vi.useFakeTimers();
		const pendingItem = createInboxItem({
			id: "temporary-read-failure-item",
			importance: "urgent",
		});
		pendingItemIds.add(
			buildPendingItemKey({
				itemId: pendingItem.id,
				organizationId: "organization-123",
				userId: "user-123",
			})
		);
		currentItems = [createInboxItem({ id: "first-page-item" })];
		queryClientMock.fetchQuery
			.mockRejectedValueOnce(new Error("Inbox unavailable"))
			.mockResolvedValue({ item: pendingItem });
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		renderListener();
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(queryClientMock.fetchQuery).toHaveBeenCalledOnce();
		expect(hasPendingItem(pendingItem.id)).toBe(true);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(queryClientMock.fetchQuery).toHaveBeenCalledTimes(2);
		expect(showInboxNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({ item: pendingItem })
		);
		expect(hasPendingItem(pendingItem.id)).toBe(false);
	});

	it("bounds concurrent reads while recovering off-page pending items", async () => {
		const pendingItems = Array.from({ length: 7 }, (_, index) =>
			createInboxItem({
				id: `bounded-pending-${index}`,
				importance: "urgent",
			})
		);
		for (const item of pendingItems) {
			pendingItemIds.add(
				buildPendingItemKey({
					itemId: item.id,
					organizationId: "organization-123",
					userId: "user-123",
				})
			);
		}
		currentItems = [createInboxItem({ id: "first-page-item" })];
		const pendingReads: Array<{
			item: InboxItem;
			resolve: (value: { item: InboxItem }) => void;
		}> = [];
		queryClientMock.fetchQuery.mockImplementation(
			(input: { itemId: string }) => {
				const pendingItem = pendingItems.find(
					(item) => item.id === input.itemId
				);
				if (!pendingItem) {
					throw new Error(`Unexpected pending item ${input.itemId}.`);
				}
				return new Promise((resolve) => {
					pendingReads.push({ item: pendingItem, resolve });
				});
			}
		);

		renderListener();
		await waitFor(() => {
			expect(queryClientMock.fetchQuery).toHaveBeenCalledTimes(6);
		});
		expect(pendingReads).toHaveLength(6);

		act(() => {
			for (const read of pendingReads) {
				read.resolve({ item: read.item });
			}
		});
		await waitFor(() => {
			expect(queryClientMock.fetchQuery).toHaveBeenCalledTimes(7);
		});
	});

	it("invalidates a queued delivery when the signed-in user changes", async () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const queuedItem = createInboxItem({
			id: "queued-user-item",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();
		let queuedInput: TestDeliveryInput | undefined;
		let resolveQueued: ((value: unknown) => void) | undefined;
		showInboxNotificationMock.mockImplementationOnce(
			(input: TestDeliveryInput) => {
				queuedInput = input;
				return new Promise((resolve) => {
					resolveQueued = resolve;
				});
			}
		);

		currentItems = [queuedItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await waitFor(() => expect(queuedInput).toBeDefined());
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-456"
			/>
		);

		await expect(queuedInput?.resolveCurrentReadiness?.()).resolves.toEqual({
			status: "context_changed",
		});
		act(() => {
			resolveQueued?.({ reason: "context_changed", status: "deferred" });
		});
		expect(hasPendingItem(queuedItem.id)).toBe(true);
	});

	it("invalidates a queued delivery when the listener unmounts", async () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const queuedItem = createInboxItem({
			id: "queued-unmount-item",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();
		let queuedInput: TestDeliveryInput | undefined;
		let rejectQueued: ((reason: unknown) => void) | undefined;
		showInboxNotificationMock.mockImplementationOnce(
			(input: TestDeliveryInput) => {
				queuedInput = input;
				return new Promise((_resolve, reject) => {
					rejectQueued = reject;
				});
			}
		);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		currentItems = [queuedItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		expect(queuedInput).toBeDefined();

		view.unmount();
		const setTimeoutSpy = vi
			.spyOn(globalThis, "setTimeout")
			.mockReturnValue(1 as unknown as ReturnType<typeof setTimeout>);
		const readinessAfterUnmount = queuedInput?.resolveCurrentReadiness?.();
		await act(async () => {
			rejectQueued?.(new Error("Notification constructor failed"));
			await Promise.resolve();
		});

		await expect(readinessAfterUnmount).resolves.toEqual({
			status: "context_changed",
		});
		expect(setTimeoutSpy).not.toHaveBeenCalled();
		expect(hasPendingItem(queuedItem.id)).toBe(true);
	});

	it("cancels a delivery retry when the signed-in user changes", async () => {
		vi.useFakeTimers();
		const existingItem = createInboxItem({ id: "existing-item" });
		const failedItem = createInboxItem({
			id: "failed-user-item",
			importance: "urgent",
		});
		const nextUserPendingItem = createInboxItem({
			id: "next-user-pending-item",
			importance: "urgent",
			recipientUserId: "user-456",
		});
		currentItems = [existingItem];
		const view = renderListener();
		showInboxNotificationMock.mockRejectedValueOnce(
			new Error("Notification constructor failed")
		);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		currentItems = [failedItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(showInboxNotificationMock).toHaveBeenCalledOnce();

		notificationSettingsByUserId.set("user-456", false);
		pendingItemIds.add(
			buildPendingItemKey({
				itemId: nextUserPendingItem.id,
				organizationId: "organization-123",
				userId: "user-456",
			})
		);
		currentItems = [nextUserPendingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-456"
			/>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(showInboxNotificationMock).toHaveBeenCalledOnce();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});

		expect(itemsQueryMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ enabled: true })
		);
		expect(showInboxNotificationMock).toHaveBeenCalledOnce();
	});

	it("uses push while connected, drains pending observations and resumes polling on disconnect", () => {
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		const socket = Object.assign(new EventTarget(), {
			send: vi.fn(),
			close: vi.fn(),
		});
		vi.spyOn(
			accountStream,
			"createAccountInvalidationTransport"
		).mockReturnValue(socket);
		renderListener();
		const interval = (hasMore = false) =>
			itemsQueryMock.mock.lastCall?.[0].refetchInterval({
				state: { data: { hasMore } },
			});
		expect(interval()).toBe(1000);
		act(() => socket.dispatchEvent(new Event("open")));
		expect(interval()).toBe(30_000);
		expect(interval(true)).toBe(1000);
		const reads = itemsRefetch.mock.calls.length;
		act(() =>
			socket.dispatchEvent(
				new MessageEvent("message", {
					data: JSON.stringify({ type: "inbox.changed" }),
				})
			)
		);
		expect(itemsRefetch.mock.calls.length).toBeGreaterThan(reads);
		act(() => socket.dispatchEvent(new Event("close")));
		expect(interval()).toBe(1000);
	});
	it("backs off disconnected polling and restarts it on reconnect and focus", () => {
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		vi.spyOn(Math, "random").mockReturnValue(1);
		const socket = Object.assign(new EventTarget(), {
			send: vi.fn(),
			close: vi.fn(),
		});
		vi.spyOn(
			accountStream,
			"createAccountInvalidationTransport"
		).mockReturnValue(socket);
		renderListener();
		const interval = (fetchedAt: number) =>
			itemsQueryMock.mock.lastCall?.[0].refetchInterval({
				state: {
					data: { hasMore: false, items: [] },
					dataUpdatedAt: fetchedAt,
					errorUpdatedAt: 0,
				},
			});
		expect([1, 2, 3, 4].map(interval)).toEqual([1000, 2000, 4000, 8000]);
		// Re-evaluating the same fetch keeps its delay.
		expect(interval(4)).toBe(8000);
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		expect(interval(5)).toBe(1000);
		expect(interval(6)).toBe(2000);
		act(() => socket.dispatchEvent(new Event("open")));
		expect(interval(7)).toBe(30_000);
		act(() => socket.dispatchEvent(new Event("close")));
		expect(interval(8)).toBe(1000);
	});

	it("skips native polls while push is connected except for recovery", () => {
		vi.useFakeTimers();
		let poll: (() => void) | undefined;
		desktopPlatformMock.mockReturnValue({
			setNotificationContext: vi.fn(async () => undefined),
			onNotificationClick: () => () => undefined,
			onNotificationPoll: (listener: () => void) => {
				poll = listener;
				return () => undefined;
			},
		});
		const socket = Object.assign(new EventTarget(), {
			send: vi.fn(),
			close: vi.fn(),
		});
		vi.spyOn(
			accountStream,
			"createAccountInvalidationTransport"
		).mockReturnValue(socket);
		renderListener();
		act(() => poll?.());
		expect(summaryRefetch).toHaveBeenCalledTimes(1);
		act(() => socket.dispatchEvent(new Event("open")));
		act(() => {
			vi.advanceTimersByTime(10_000);
			poll?.();
		});
		expect(summaryRefetch).toHaveBeenCalledTimes(1);
		act(() => {
			vi.advanceTimersByTime(20_000);
			poll?.();
		});
		expect(summaryRefetch).toHaveBeenCalledTimes(2);
		// A read elsewhere adds no observation, so push refreshes the tray
		// summary directly, coalesced across a burst of frames.
		act(() => {
			for (let frame = 0; frame < 3; frame += 1) {
				socket.dispatchEvent(
					new MessageEvent("message", {
						data: JSON.stringify({ type: "inbox.changed" }),
					})
				);
			}
			vi.advanceTimersByTime(1000);
		});
		expect(summaryRefetch).toHaveBeenCalledTimes(3);
		act(() => socket.dispatchEvent(new Event("close")));
		act(() => poll?.());
		expect(summaryRefetch).toHaveBeenCalledTimes(4);
	});

	it("backs off short-lived connections until a keepalive succeeds", async () => {
		vi.useFakeTimers();
		const sockets = Array.from({ length: 4 }, () =>
			Object.assign(new EventTarget(), { send: vi.fn(), close: vi.fn() })
		);
		const connect = vi.spyOn(
			accountStream,
			"createAccountInvalidationTransport"
		);
		for (const socket of sockets) {
			connect.mockReturnValueOnce(socket);
		}
		renderListener();
		act(() => sockets[0]?.dispatchEvent(new Event("open")));
		const reads = itemsRefetch.mock.calls.length;
		act(() => sockets[0]?.dispatchEvent(new Event("close")));
		// Polling already repairs missed changes while disconnected.
		expect(itemsRefetch).toHaveBeenCalledTimes(reads);
		await act(() => vi.advanceTimersByTimeAsync(1000));
		expect(connect).toHaveBeenCalledTimes(2);
		act(() => sockets[1]?.dispatchEvent(new Event("open")));
		act(() => sockets[1]?.dispatchEvent(new Event("close")));
		await act(() => vi.advanceTimersByTimeAsync(1000));
		expect(connect).toHaveBeenCalledTimes(2);
		await act(() => vi.advanceTimersByTimeAsync(1000));
		expect(connect).toHaveBeenCalledTimes(3);
		act(() => sockets[2]?.dispatchEvent(new Event("open")));
		await act(() => vi.advanceTimersByTimeAsync(25_000));
		expect(sockets[2]?.send).toHaveBeenCalledWith("ping");
		act(() =>
			sockets[2]?.dispatchEvent(new MessageEvent("message", { data: "pong" }))
		);
		act(() => sockets[2]?.dispatchEvent(new Event("close")));
		await act(() => vi.advanceTimersByTimeAsync(1000));
		expect(connect).toHaveBeenCalledTimes(4);
	});

	it("refreshes unopened Space membership from account push without waiting for a poll", async () => {
		vi.useFakeTimers();
		notificationSettingsByUserId.set("user-123", false);
		const socket = Object.assign(new EventTarget(), {
			send: vi.fn(),
			close: vi.fn(),
		});
		vi.spyOn(
			accountStream,
			"createAccountInvalidationTransport"
		).mockReturnValue(socket);
		renderListener();
		act(() => socket.dispatchEvent(new Event("open")));
		queryClientMock.invalidateQueries.mockClear();
		act(() =>
			socket.dispatchEvent(
				new MessageEvent("message", {
					data: JSON.stringify({ type: "space_index.changed" }),
				})
			)
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});
		expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: ["spaces", "account-spaces"],
			})
		);
	});

	it("refreshes an active Space directory from a new Inbox message even when notifications are off", () => {
		notificationSettingsByUserId.set("user-123", false);
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		const view = renderListener();
		const options = itemsQueryMock.mock.lastCall?.[0] as {
			enabled: boolean;
			refetchInterval: (query: {
				state: { data: { hasMore: boolean } };
			}) => number | false;
		};
		expect(options.enabled).toBe(true);
		expect(
			options.refetchInterval({ state: { data: { hasMore: false } } })
		).toBe(1000);

		currentItems = [createInboxItem({ id: "new-space-message" })];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith(
			expect.objectContaining({ queryKey: ["spaces", "account-spaces"] })
		);
		const refreshFilter =
			queryClientMock.invalidateQueries.mock.lastCall?.[0]?.predicate;
		expect(
			refreshFilter?.({
				queryKey: ["spaces", "account-spaces", "profile-123", "account"],
			})
		).toBe(true);
		expect(
			refreshFilter?.({
				queryKey: [
					"spaces",
					"account-spaces",
					"profile-123",
					"active-wake-summary",
				],
			})
		).toBe(false);
		expect(showInboxNotificationMock).not.toHaveBeenCalled();
	});

	it("does not let a late recovery failure from an old Organization block the current feed retry", async () => {
		vi.useFakeTimers();
		const oldPendingItem = createInboxItem({
			id: "old-organization-pending-item",
			importance: "urgent",
		});
		pendingItemIds.add(
			buildPendingItemKey({
				itemId: oldPendingItem.id,
				organizationId: "organization-123",
				userId: "user-123",
			})
		);
		currentItems = [createInboxItem({ id: "old-first-page-item" })];
		let rejectOldRecovery: ((error: Error) => void) | undefined;
		queryClientMock.fetchQuery.mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					rejectOldRecovery = reject;
				})
		);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const view = renderListener();
		await act(async () => {
			await Promise.resolve();
		});
		expect(queryClientMock.fetchQuery).toHaveBeenCalledOnce();

		const currentFeedExistingItem = createInboxItem({
			id: "current-feed-existing-item",
			organizationId: "organization-456",
		});
		currentItems = [currentFeedExistingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-456"
				organizationSlug="next-organization"
				userId="user-123"
			/>
		);
		await act(async () => {
			rejectOldRecovery?.(new Error("Old Organization Inbox unavailable"));
			await Promise.resolve();
		});

		const currentFeedItem = createInboxItem({
			id: "current-feed-delivery-failure",
			importance: "urgent",
			organizationId: "organization-456",
		});
		showInboxNotificationMock.mockRejectedValueOnce(
			new Error("Notification constructor failed")
		);
		currentItems = [currentFeedItem, currentFeedExistingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-456"
				organizationSlug="next-organization"
				userId="user-123"
			/>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(showInboxNotificationMock).toHaveBeenCalledOnce();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});

		expect(showInboxNotificationMock).toHaveBeenCalledTimes(2);
		expect(
			pendingItemIds.has(
				buildPendingItemKey({
					itemId: currentFeedItem.id,
					organizationId: "organization-456",
					userId: "user-123",
				})
			)
		).toBe(false);
	});

	it("rechecks current-conversation suppression after a delivery was queued", async () => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		const existingItem = createInboxItem({ id: "existing-item" });
		const queuedItem = createInboxItem({
			id: "queued-route-item",
			importance: "urgent",
		});
		currentItems = [existingItem];
		getCurrentInboxItemMock.mockResolvedValue({ item: queuedItem });
		const view = renderListener();
		let queuedInput: TestDeliveryInput | undefined;
		let resolveQueued: ((value: unknown) => void) | undefined;
		showInboxNotificationMock.mockImplementationOnce(
			(input: TestDeliveryInput) => {
				queuedInput = input;
				return new Promise((resolve) => {
					resolveQueued = resolve;
				});
			}
		);

		currentItems = [queuedItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await waitFor(() => expect(queuedInput).toBeDefined());
		usePathnameMock.mockReturnValue("/o/amplift/spaces/space-123");
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		await expect(queuedInput?.resolveCurrentReadiness?.()).resolves.toEqual({
			status: "source_visible",
		});
		act(() => {
			resolveQueued?.({ reason: "source_visible", status: "deferred" });
		});
		expect(hasPendingItem(queuedItem.id)).toBe(true);
	});

	it("updates queued delivery context before sibling layout effects run", async () => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		const existingItem = createInboxItem({ id: "existing-item" });
		const queuedItem = createInboxItem({
			id: "layout-queued-route-item",
			importance: "urgent",
		});
		currentItems = [existingItem];
		getCurrentInboxItemMock.mockResolvedValue({ item: queuedItem });
		let queuedInput: TestDeliveryInput | undefined;
		showInboxNotificationMock.mockImplementationOnce(
			(input: TestDeliveryInput) => {
				queuedInput = input;
				return new Promise(() => undefined);
			}
		);
		const view = render(
			<>
				<InboxNotificationListener
					organizationId="organization-123"
					organizationSlug="amplift"
					userId="user-123"
				/>
				<LayoutProbe onLayout={() => undefined} />
			</>
		);
		currentItems = [queuedItem, existingItem];
		view.rerender(
			<>
				<InboxNotificationListener
					organizationId="organization-123"
					organizationSlug="amplift"
					userId="user-123"
				/>
				<LayoutProbe onLayout={() => undefined} />
			</>
		);
		await waitFor(() => expect(queuedInput).toBeDefined());

		usePathnameMock.mockReturnValue("/o/amplift/spaces/space-123");
		let readinessDuringLayout: Promise<TestDeliveryReadiness> | undefined;
		view.rerender(
			<>
				<InboxNotificationListener
					organizationId="organization-123"
					organizationSlug="amplift"
					userId="user-123"
				/>
				<LayoutProbe
					onLayout={() => {
						readinessDuringLayout = Promise.resolve(
							queuedInput?.resolveCurrentReadiness?.() ?? {
								status: "missing",
							}
						);
					}}
				/>
			</>
		);

		await expect(readinessDuringLayout).resolves.toEqual({
			status: "source_visible",
		});
	});

	it.each([
		["mentions_and_replies", "ineligible"],
		["all_messages", "eligible"],
		["muted", "ineligible"],
	])("revalidates ordinary messages against the latest %s preference and excludes resolved actions", async (mode, status) => {
		const existingItem = createInboxItem({ id: "existing-item" });
		currentItems = [existingItem];
		const view = renderListener();

		currentItems = [
			createInboxItem({ id: "ordinary-update" }),
			createInboxItem({
				attention: "action_required",
				id: "resolved-action",
				resolutionStatus: "resolved",
			}),
			existingItem,
		];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		expect(showInboxNotificationMock).toHaveBeenCalledOnce();
		getCurrentInboxItemMock.mockResolvedValue({ item: currentItems[0] });
		// Preferences can change while the delivery waits for its cross-tab lock.
		getMessagePreferencesMock.mockResolvedValue({ effectiveMode: mode });
		const delivery = showInboxNotificationMock.mock
			.calls[0]?.[0] as TestDeliveryInput;
		await expect(delivery.resolveCurrentReadiness?.()).resolves.toMatchObject({
			status,
		});
		expect(getMessagePreferencesMock).toHaveBeenCalledWith({
			organizationId: "organization-123",
			spaceId: "space-123",
		});

		expect(invalidateInboxFactsMock).toHaveBeenCalledOnce();
	});

	it("keeps unavailable preference reads retryable and suppresses revoked conversations", async () => {
		currentItems = [];
		const view = renderListener();
		const item = createInboxItem({ id: "preference-retry" });
		currentItems = [item];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		getCurrentInboxItemMock.mockResolvedValue({ item });
		const delivery = showInboxNotificationMock.mock
			.calls[0]?.[0] as TestDeliveryInput;
		getMessagePreferencesMock.mockRejectedValueOnce({
			status: 404,
			code: "route_not_found",
		});
		await expect(delivery.resolveCurrentReadiness?.()).resolves.toEqual({
			status: "revalidation_failed",
		});
		getMessagePreferencesMock.mockResolvedValueOnce({
			effectiveMode: "all_messages",
		});
		await expect(delivery.resolveCurrentReadiness?.()).resolves.toMatchObject({
			status: "eligible",
		});
		getMessagePreferencesMock.mockRejectedValueOnce({
			status: 404,
			code: "inbox.conversation_not_found",
		});
		await expect(delivery.resolveCurrentReadiness?.()).resolves.toEqual({
			status: "ineligible",
		});
	});
	it("delivers a directly addressed reply and reports whether the source session is being viewed", () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		currentItems = [existingItem];
		const view = renderListener();

		const reference = createInboxItem({
			id: "reference-item",
			kind: "space_mention",
			sourceTarget: {
				kind: "space",
				signalId: "signal-reference",
				spaceId: "space-123",
			},
		});
		currentItems = [reference, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		expect(showInboxNotificationMock).toHaveBeenCalledOnce();
		expect(showInboxNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				item: reference,
				viewingSourceSession: false,
			})
		);

		showInboxNotificationMock.mockClear();
		usePathnameMock.mockReturnValue("/o/amplift/spaces/space-123");
		const viewedReply = createInboxItem({
			id: "viewed-reply",
			kind: "agent_reply",
			sourceTarget: {
				kind: "space",
				signalId: "signal-viewed",
				spaceId: "space-123",
			},
		});
		currentItems = [viewedReply, reference, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		expect(showInboxNotificationMock).toHaveBeenCalledOnce();
		expect(showInboxNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				item: viewedReply,
				viewingSourceSession: true,
			})
		);
	});

	it("re-primes the seen-item set when the signed-in user changes", () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const firstUserItem = createInboxItem({
			id: "first-user-item",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();

		currentItems = [firstUserItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		expect(showInboxNotificationMock).toHaveBeenCalledOnce();

		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-456"
			/>
		);
		expect(showInboxNotificationMock).toHaveBeenCalledOnce();

		const secondUserItem = createInboxItem({
			id: "second-user-item",
			importance: "urgent",
			recipientUserId: "user-456",
		});
		currentItems = [secondUserItem, firstUserItem, existingItem];
		view.rerender(
			<InboxNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-456"
			/>
		);

		expect(showInboxNotificationMock).toHaveBeenCalledTimes(2);
		expect(showInboxNotificationMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ item: secondUserItem })
		);
	});
});

function renderListener() {
	return render(
		<InboxNotificationListener
			organizationId="organization-123"
			organizationSlug="amplift"
			userId="user-123"
		/>
	);
}

function LayoutProbe({ onLayout }: { onLayout: () => void }) {
	useLayoutEffect(() => {
		onLayout();
	}, [onLayout]);
	return null;
}

function buildPendingItemKey(input: {
	itemId: string;
	organizationId: string;
	userId: string;
}): string {
	return `${input.organizationId}:${input.userId}:${input.itemId}`;
}

function hasPendingItem(itemId: string): boolean {
	return pendingItemIds.has(
		buildPendingItemKey({
			itemId,
			organizationId: "organization-123",
			userId: "user-123",
		})
	);
}

function createInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
	return {
		attention: "update",
		contextLabel: "Design Room",
		createdAt: "2026-08-04T01:00:00.000Z",
		id: "item-123",
		importance: "normal",
		kind: "space_message",
		occurredAt: "2026-08-04T01:00:00.000Z",
		organizationId: "organization-123",
		preview: "Review the latest message.",
		readAt: null,
		recipientUserId: "user-123",
		resolutionStatus: "not_applicable",
		sourceTarget: {
			kind: "space",
			signalId: "signal-123",
			spaceId: "space-123",
		},
		title: "New Space message",
		updatedAt: "2026-08-04T01:00:00.000Z",
		...overrides,
	};
}
