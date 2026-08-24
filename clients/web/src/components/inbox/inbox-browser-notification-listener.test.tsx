import type { InboxItem } from "@openmeld/schemas/types";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxBrowserNotificationListener } from "./inbox-browser-notification-listener";

const useInfiniteQueryMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const showInboxBrowserNotificationMock = vi.hoisted(() => vi.fn());
const invalidateInboxSummaryMock = vi.hoisted(() => vi.fn());
const pendingItemIds = vi.hoisted(() => new Set<string>());
const notificationSettingsSubscription = vi.hoisted(() => ({
	onChange: null as (() => void) | null,
}));

vi.mock("@tanstack/react-router", () => ({
	useLocation: () => ({ pathname: usePathnameMock() }),
}));

vi.mock("@tanstack/react-query", () => ({
	useInfiniteQuery: useInfiniteQueryMock,
	useQueryClient: () => ({}),
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
		item.importance === "urgent" ||
		(item.attention === "action_required" &&
			item.resolutionStatus === "open") ||
		item.kind === "space_reference" ||
		item.kind === "agent_reply" ||
		item.kind === "wake_outcome" ||
		item.kind === "center_agent_task",
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
	readInboxBrowserNotificationSettings: () => ({
		enabled: true,
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

vi.mock("#/lib/inbox/source-target", () => ({
	isInboxItemSourceLocation: (input: {
		item: InboxItem;
		pathname: string | null;
	}) =>
		input.pathname?.includes(
			(input.item.sourceTarget as { spaceId?: string }).spaceId ?? "\u0000"
		),
}));

vi.mock("#/query/organizations/inbox", () => ({
	inboxItemsInfiniteQueryOptions: (input: unknown) => input,
	invalidateInboxSummary: invalidateInboxSummaryMock,
}));

describe("InboxBrowserNotificationListener", () => {
	let currentItems: InboxItem[];

	beforeEach(() => {
		currentItems = [];
		pendingItemIds.clear();
		notificationSettingsSubscription.onChange = null;
		showInboxBrowserNotificationMock
			.mockReset()
			.mockResolvedValue({ notification: {}, status: "delivered" });
		invalidateInboxSummaryMock.mockReset().mockResolvedValue(undefined);
		usePathnameMock.mockReset().mockReturnValue("/o/amplift/home");
		useInfiniteQueryMock.mockReset().mockImplementation(() => ({
			data: {
				pageParams: [undefined],
				pages: [
					{
						items: currentItems,
						nextCursor: null,
						organizationId: "organization-123",
					},
				],
			},
		}));
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
		expect(invalidateInboxSummaryMock).toHaveBeenCalledWith({
			organizationId: "organization-123",
			queryClient: {},
		});
		expect(showInboxBrowserNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				item: newItem,
				sourcePath: "/o/amplift/inbox?item=new-item",
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

	it("invalidates a queued delivery when the signed-in user changes", async () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		const queuedItem = createInboxItem({
			id: "queued-user-item",
			importance: "urgent",
		});
		currentItems = [existingItem];
		const view = renderListener();
		let queuedInput:
			| {
					resolveCurrentReadiness?: () => string;
			  }
			| undefined;
		let resolveQueued: ((value: unknown) => void) | undefined;
		showInboxBrowserNotificationMock.mockImplementationOnce(
			(input: { resolveCurrentReadiness?: () => string }) => {
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

		expect(queuedInput?.resolveCurrentReadiness?.()).toBe("context_changed");
		act(() => {
			resolveQueued?.({ reason: "context_changed", status: "deferred" });
		});
		expect(hasPendingItem(queuedItem.id)).toBe(true);
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
		const view = renderListener();
		let queuedInput:
			| {
					resolveCurrentReadiness?: () => string;
			  }
			| undefined;
		let resolveQueued: ((value: unknown) => void) | undefined;
		showInboxBrowserNotificationMock.mockImplementationOnce(
			(input: { resolveCurrentReadiness?: () => string }) => {
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

		expect(queuedInput?.resolveCurrentReadiness?.()).toBe("source_visible");
		act(() => {
			resolveQueued?.({ reason: "source_visible", status: "deferred" });
		});
		expect(hasPendingItem(queuedItem.id)).toBe(true);
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
		expect(invalidateInboxSummaryMock).toHaveBeenCalledOnce();
	});

	it("delivers a directly addressed reply and reports whether the source session is being viewed", () => {
		const existingItem = createInboxItem({ id: "existing-item" });
		currentItems = [existingItem];
		const view = renderListener();

		const reference = createInboxItem({
			id: "reference-item",
			kind: "space_reference",
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
