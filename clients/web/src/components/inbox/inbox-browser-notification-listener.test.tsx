import type { InboxItem } from "@openmeld/schemas/types";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxBrowserNotificationListener } from "./inbox-browser-notification-listener";

const useInfiniteQueryMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const showInboxBrowserNotificationMock = vi.hoisted(() => vi.fn());
const invalidateInboxFactsMock = vi.hoisted(() => vi.fn());
const getCurrentInboxItemMock = vi.hoisted(() => vi.fn());
const queryClientMock = vi.hoisted(() => ({ fetchQuery: vi.fn() }));
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
	useLocation: () => ({ pathname: usePathnameMock() }),
}));

vi.mock("@tanstack/react-query", () => ({
	useInfiniteQuery: useInfiniteQueryMock,
	useQueryClient: () => queryClientMock,
}));

vi.mock("#/lib/inbox/browser-notifications", () => ({
	clearInboxBrowserNotificationItemPending: (input: {
		itemId: string;
		organizationId: string;
		userId: string;
	}) => {
		pendingItemIds.delete(buildPendingItemKey(input));
	},
	isInboxBrowserNotificationEligible: (item: InboxItem) =>
		item.resolutionStatus !== "resolved" &&
		(item.importance === "urgent" ||
			(item.attention === "action_required" &&
				item.resolutionStatus === "open") ||
			item.kind === "space_mention" ||
			item.kind === "agent_reply" ||
			item.kind === "wake_outcome" ||
			item.kind === "center_agent_task"),
	markInboxBrowserNotificationItemPending: (input: {
		itemId: string;
		organizationId: string;
		userId: string;
	}) => {
		pendingItemIds.add(buildPendingItemKey(input));
	},
	readPendingInboxBrowserNotificationItemIds: (input: {
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
	readInboxBrowserNotificationSettings: (input: { userId: string }) => ({
		enabled: notificationSettingsByUserId.get(input.userId) ?? true,
		permission: "granted",
	}),
	showInboxBrowserNotification: showInboxBrowserNotificationMock,
	subscribeInboxBrowserNotificationSettings: (onChange: () => void) => {
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
}));

vi.mock("#/query/organizations/inbox", () => ({
	inboxBrowserNotificationRecoveryItemQueryOptions: (input: unknown) => ({
		...(input as object),
		staleTime: 0,
	}),
	inboxItemsInfiniteQueryOptions: (input: unknown) => input,
	invalidateInboxFacts: invalidateInboxFactsMock,
}));

describe("InboxBrowserNotificationListener", () => {
	let currentItems: InboxItem[];
	let queryDataItems: InboxItem[] | null;
	let queryData:
		| {
				pageParams: undefined[];
				pages: Array<{
					items: InboxItem[];
					nextCursor: null;
					organizationId: string;
				}>;
		  }
		| undefined;

	beforeEach(() => {
		currentItems = [];
		queryDataItems = null;
		queryData = undefined;
		pendingItemIds.clear();
		notificationSettingsByUserId.clear();
		notificationSettingsSubscription.onChange = null;
		showInboxBrowserNotificationMock
			.mockReset()
			.mockResolvedValue({ notification: {}, status: "delivered" });
		invalidateInboxFactsMock.mockReset().mockResolvedValue(undefined);
		queryClientMock.fetchQuery.mockReset();
		getCurrentInboxItemMock.mockReset();
		usePathnameMock.mockReset().mockReturnValue("/o/amplift/home");
		useInfiniteQueryMock.mockReset().mockImplementation(() => {
			if (queryDataItems !== currentItems) {
				queryDataItems = currentItems;
				queryData = {
					pageParams: [undefined],
					pages: [
						{
							items: currentItems,
							nextCursor: null,
							organizationId: "organization-123",
						},
					],
				};
			}
			return { data: queryData };
		});
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("primes existing items without notifying, then delivers a newly arrived urgent item", () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const newItem = createInboxItem({
			id: "new-item",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();

		expect(showInboxBrowserNotificationMock).not.toHaveBeenCalled();

		currentItems = [newItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();
		expect(invalidateInboxFactsMock).toHaveBeenCalledWith({
			organizationId: "organization-123",
			queryClient: queryClientMock,
		});
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				item: newItem,
				sourcePath: "/o/amplift/spaces/space-123?focusSignalId=signal-123",
			})
		);
	});

	it("retries a new item after current-conversation suppression no longer applies", async () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const newItem = createInboxItem({
			id: "retry-after-source-suppression",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();
		showInboxBrowserNotificationMock
			.mockResolvedValueOnce({
				reason: "source_visible",
				status: "deferred",
			})
			.mockResolvedValueOnce({ notification: {}, status: "delivered" });

		currentItems = [newItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await waitFor(() => {
			expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();
		});

		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		act(() => notificationSettingsSubscription.onChange?.());

		await waitFor(() => {
			expect(showInboxBrowserNotificationMock).toHaveBeenCalledTimes(2);
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
		showInboxBrowserNotificationMock
			.mockRejectedValueOnce(new Error("Notification constructor failed"))
			.mockResolvedValueOnce({ notification: {}, status: "delivered" });
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		currentItems = [newItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledTimes(2);
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
		showInboxBrowserNotificationMock
			.mockResolvedValueOnce({
				reason,
				status: "deferred",
			})
			.mockResolvedValueOnce({ notification: {}, status: "delivered" });

		currentItems = [newItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledTimes(2);
	});

	it("retries a pending delivery after the listener remounts", async () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const pendingItem = createInboxItem({
			id: "retry-after-remount",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();
		showInboxBrowserNotificationMock.mockRejectedValueOnce(
			new Error("Notification constructor failed")
		);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		currentItems = [pendingItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await waitFor(() => {
			expect(hasPendingItem(pendingItem.id)).toBe(true);
		});
		view.unmount();
		showInboxBrowserNotificationMock.mockResolvedValueOnce({
			notification: {},
			status: "delivered",
		});

		renderListener();
		await waitFor(() => {
			expect(showInboxBrowserNotificationMock).toHaveBeenCalledTimes(2);
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
			expect(showInboxBrowserNotificationMock).toHaveBeenCalledWith(
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
		showInboxBrowserNotificationMock.mockImplementationOnce(
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
			<InboxBrowserNotificationListener
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
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();
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
		showInboxBrowserNotificationMock.mockImplementationOnce(
			async (input: TestDeliveryInput) => {
				currentReadiness = await input.resolveCurrentReadiness?.();
				return currentReadiness?.status === "ineligible"
					? { status: "ineligible" }
					: { reason: "revalidation_failed", status: "deferred" };
			}
		);

		currentItems = [queuedItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
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
		showInboxBrowserNotificationMock.mockImplementationOnce(
			async (input: TestDeliveryInput) => {
				currentReadiness = await input.resolveCurrentReadiness?.();
				return { notification: {}, status: "delivered" };
			}
		);

		currentItems = [queuedItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
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
		expect(showInboxBrowserNotificationMock).not.toHaveBeenCalled();
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
		expect(showInboxBrowserNotificationMock).not.toHaveBeenCalled();
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
		showInboxBrowserNotificationMock.mockResolvedValueOnce({
			reason: "source_visible",
			status: "deferred",
		});

		renderListener();
		await waitFor(() => {
			expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();
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
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();
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
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledWith(
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
		showInboxBrowserNotificationMock.mockImplementationOnce(
			(input: TestDeliveryInput) => {
				queuedInput = input;
				return new Promise((resolve) => {
					resolveQueued = resolve;
				});
			}
		);

		currentItems = [queuedItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await waitFor(() => expect(queuedInput).toBeDefined());
		view.rerender(
			<InboxBrowserNotificationListener
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
		showInboxBrowserNotificationMock.mockImplementationOnce(
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
			<InboxBrowserNotificationListener
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
		showInboxBrowserNotificationMock.mockRejectedValueOnce(
			new Error("Notification constructor failed")
		);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		currentItems = [failedItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();

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
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-456"
			/>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});

		expect(useInfiniteQueryMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ enabled: false })
		);
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();
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
			<InboxBrowserNotificationListener
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
		showInboxBrowserNotificationMock.mockRejectedValueOnce(
			new Error("Notification constructor failed")
		);
		currentItems = [currentFeedItem, currentFeedExistingItem];
		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-456"
				organizationSlug="next-organization"
				userId="user-123"
			/>
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});

		expect(showInboxBrowserNotificationMock).toHaveBeenCalledTimes(2);
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
		showInboxBrowserNotificationMock.mockImplementationOnce(
			(input: TestDeliveryInput) => {
				queuedInput = input;
				return new Promise((resolve) => {
					resolveQueued = resolve;
				});
			}
		);

		currentItems = [queuedItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		await waitFor(() => expect(queuedInput).toBeDefined());
		usePathnameMock.mockReturnValue("/o/amplift/spaces/space-123");
		view.rerender(
			<InboxBrowserNotificationListener
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
		showInboxBrowserNotificationMock.mockImplementationOnce(
			(input: TestDeliveryInput) => {
				queuedInput = input;
				return new Promise(() => undefined);
			}
		);
		const view = render(
			<>
				<InboxBrowserNotificationListener
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
				<InboxBrowserNotificationListener
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
				<InboxBrowserNotificationListener
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

	it("keeps ordinary updates and resolved actions in Inbox without browser delivery", () => {
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
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		expect(showInboxBrowserNotificationMock).not.toHaveBeenCalled();
		expect(invalidateInboxFactsMock).toHaveBeenCalledOnce();
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
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				item: reference,
				viewingSourceSession: false,
			})
		);

		showInboxBrowserNotificationMock.mockClear();
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
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);

		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledWith(
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
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-123"
			/>
		);
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();

		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-456"
			/>
		);
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledOnce();

		const secondUserItem = createInboxItem({
			id: "second-user-item",
			importance: "urgent",
			recipientUserId: "user-456",
		});
		currentItems = [secondUserItem, firstUserItem, existingItem];
		view.rerender(
			<InboxBrowserNotificationListener
				organizationId="organization-123"
				organizationSlug="amplift"
				userId="user-456"
			/>
		);

		expect(showInboxBrowserNotificationMock).toHaveBeenCalledTimes(2);
		expect(showInboxBrowserNotificationMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ item: secondUserItem })
		);
	});
});

function renderListener() {
	return render(
		<InboxBrowserNotificationListener
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
