import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	INBOX_LIST_POLL_INTERVAL_MS,
	INBOX_SUMMARY_POLL_INTERVAL_MS,
	inboxBrowserNotificationRecoveryItemQueryOptions,
	inboxItemsInfiniteQueryOptions,
	inboxNotificationPreferencesQueryOptions,
	inboxQueryKeys,
	inboxSummaryQueryOptions,
	spaceInboxSummaryQueryOptions,
} from "./inbox";

const getCurrentInboxNotificationPreferencesMock = vi.hoisted(() => vi.fn());
const getCurrentInboxItemMock = vi.hoisted(() => vi.fn());
const getCurrentInboxSummaryMock = vi.hoisted(() => vi.fn());
const getCurrentSpaceInboxSummaryMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/organizations/inbox", () => ({
	getCurrentInboxNotificationPreferences:
		getCurrentInboxNotificationPreferencesMock,
	getCurrentInboxItem: getCurrentInboxItemMock,
	getCurrentInboxSummary: getCurrentInboxSummaryMock,
	getCurrentSpaceInboxSummary: getCurrentSpaceInboxSummaryMock,
	listCurrentInboxItems: vi.fn(),
}));

describe("Inbox summary query", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		getCurrentInboxItemMock.mockReset();
		getCurrentInboxSummaryMock.mockReset().mockResolvedValue({
			organizationId: "organization-123",
			totalUnreadCount: 27,
			unresolvedActionCount: 0,
		});
		getCurrentSpaceInboxSummaryMock.mockReset().mockResolvedValue({
			organizationId: "organization-123",
			spaces: [],
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("polls the foreground every 15 seconds and keeps focus refresh enabled", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const options = inboxSummaryQueryOptions({
			organizationId: "organization-123",
		});
		expect(options.refetchInterval).toBe(INBOX_SUMMARY_POLL_INTERVAL_MS);
		expect(options.refetchIntervalInBackground).toBe(false);
		expect(options.refetchOnWindowFocus).toBe(true);
		const observer = new QueryObserver(queryClient, options);
		const unsubscribe = observer.subscribe(() => undefined);

		await vi.advanceTimersByTimeAsync(0);
		expect(getCurrentInboxSummaryMock).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(INBOX_SUMMARY_POLL_INTERVAL_MS - 1);
		expect(getCurrentInboxSummaryMock).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(1);
		expect(getCurrentInboxSummaryMock).toHaveBeenCalledTimes(2);

		unsubscribe();
		queryClient.clear();
	});

	it("keeps the open Inbox list current without requiring browser notifications", () => {
		const options = inboxItemsInfiniteQueryOptions({
			organizationId: "organization-123",
			view: "all",
		});

		expect(options.refetchInterval).toBe(INBOX_LIST_POLL_INTERVAL_MS);
		expect(options.refetchIntervalInBackground).toBe(false);
		expect(options.refetchOnWindowFocus).toBe(true);
	});

	it("revalidates browser notification recovery against Core even while the direct item cache is fresh", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		getCurrentInboxItemMock
			.mockResolvedValueOnce({ item: { revision: 1 } })
			.mockResolvedValueOnce({ item: { revision: 2 } });
		const options = inboxBrowserNotificationRecoveryItemQueryOptions({
			itemId: "pending-item",
			organizationId: "organization-123",
		});

		const first = await queryClient.fetchQuery(options);
		const second = await queryClient.fetchQuery(options);

		expect(getCurrentInboxItemMock).toHaveBeenCalledTimes(2);
		expect(first.item).toEqual({ revision: 1 });
		expect(second.item).toEqual({ revision: 2 });
		queryClient.clear();
	});

	it("keeps Space unread facts on the existing 15-second Inbox polling cadence", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const options = spaceInboxSummaryQueryOptions({
			organizationId: "organization-123",
		});
		expect(options.queryKey).toEqual(
			inboxQueryKeys.spaceSummary("organization-123")
		);
		expect(options.refetchInterval).toBe(INBOX_SUMMARY_POLL_INTERVAL_MS);
		expect(options.refetchIntervalInBackground).toBe(false);
		const observer = new QueryObserver(queryClient, options);
		const unsubscribe = observer.subscribe(() => undefined);

		await vi.advanceTimersByTimeAsync(0);
		expect(getCurrentSpaceInboxSummaryMock).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(INBOX_SUMMARY_POLL_INTERVAL_MS);
		expect(getCurrentSpaceInboxSummaryMock).toHaveBeenCalledTimes(2);

		unsubscribe();
		queryClient.clear();
	});

	it("keeps account preferences in one cache entry while the authorization organization changes", () => {
		getCurrentInboxNotificationPreferencesMock.mockResolvedValue({
			updatedAt: null,
			urgentEmailEnabled: true,
		});
		const firstOrganization = inboxNotificationPreferencesQueryOptions({
			organizationId: "organization-a",
			userId: "user-123",
		});
		const secondOrganization = inboxNotificationPreferencesQueryOptions({
			organizationId: "organization-b",
			userId: "user-123",
		});

		expect(firstOrganization.queryKey).toEqual(
			inboxQueryKeys.preferences("user-123")
		);
		expect(secondOrganization.queryKey).toEqual(firstOrganization.queryKey);
		expect(
			inboxNotificationPreferencesQueryOptions({
				organizationId: "organization-b",
				userId: "user-456",
			}).queryKey
		).not.toEqual(firstOrganization.queryKey);
	});
});
