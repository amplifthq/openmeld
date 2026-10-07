import type {
	InboxFeedResponse,
	InboxFeedRow,
	InboxItem,
} from "@openmeld/schemas/types";
import { type InfiniteData, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { inboxQueryKeys } from "./inbox";
import { optimisticallyReadInbox } from "./inbox-optimistic-read";

const org = "org";
const key = [
	...inboxQueryKeys.feeds(org),
	"user",
	{ category: "all", unreadOnly: "false" },
];

describe("optimistic Inbox reading", () => {
	it("does not subtract a pending read twice from a refreshed server total", () => {
		const client = new QueryClient();
		const first = item("first");
		const summaryKey = inboxQueryKeys.summary(org);
		client.setQueryData(key, feed([row(first)]));
		client.setQueryData(summaryKey, {
			organizationId: org,
			totalUnreadCount: 1,
			unresolvedActionCount: 0,
			unreadUrgentUpdateCount: 0,
		});
		const a = optimisticallyReadInbox(client, org, { item: first, read: true });
		client.setQueryData(summaryKey, {
			organizationId: org,
			totalUnreadCount: 1,
			unresolvedActionCount: 0,
			unreadUrgentUpdateCount: 0,
		});
		expect(client.getQueryData(summaryKey)).toMatchObject({
			totalUnreadCount: 1,
		});
		a.settle(true);
		client.clear();
	});
	it("clears the full frozen selection count even when only one page is loaded", () => {
		const client = new QueryClient();
		const first = item("first");
		const initial = feed([row(first)]);
		const page = initial.pages[0];
		if (!page) {
			throw new Error("Missing fixture page");
		}
		page.selectionUnreadCount = 25;
		page.counts.unread = 25;
		client.setQueryData(key, initial);
		const a = optimisticallyReadInbox(client, org, {
			snapshotId: "snapshot",
			operation: "read",
		});
		expect(current(client)).toMatchObject({
			selectionUnreadCount: 0,
			counts: { unread: 0 },
		});
		a.settle(false);
		expect(current(client).counts.unread).toBe(25);
		client.clear();
	});
	it("updates the visible row, dot and counts before a response, then rolls back a failure", () => {
		const client = new QueryClient();
		const first = item("first");
		client.setQueryData(key, feed([row(first)]));
		const change = optimisticallyReadInbox(client, org, {
			item: first,
			read: true,
		});
		expect(current(client).rows[0]).toMatchObject({
			unreadCount: 0,
			dot: null,
		});
		expect(current(client).counts.unread).toBe(0);
		change.settle(false);
		expect(current(client).rows[0]).toMatchObject({
			unreadCount: 1,
			dot: "blue",
			item: { readAt: null },
		});
		client.clear();
	});
	it("does not undo a successful second read when the first read fails", () => {
		const client = new QueryClient();
		const first = item("first");
		const second = item("second");
		client.setQueryData(key, feed([row(first), row(second)]));
		const a = optimisticallyReadInbox(client, org, { item: first, read: true });
		const b = optimisticallyReadInbox(client, org, {
			item: second,
			read: true,
		});
		b.settle(true);
		a.settle(false);
		expect(current(client).rows.map((entry) => entry.unreadCount)).toEqual([
			1, 0,
		]);
		expect(current(client).counts.unread).toBe(1);
		client.clear();
	});
	it("removes read rows from unread-only views and restores them on failure", () => {
		const client = new QueryClient();
		const first = item("first");
		const unreadKey = [
			...inboxQueryKeys.feeds(org),
			"user",
			{ unreadOnly: "true" },
		];
		client.setQueryData(unreadKey, feed([row(first)]));
		const a = optimisticallyReadInbox(client, org, { item: first, read: true });
		expect(
			client.getQueryData<InfiniteData<InboxFeedResponse>>(unreadKey)?.pages[0]
				?.rows
		).toEqual([]);
		a.settle(false);
		expect(
			client.getQueryData<InfiniteData<InboxFeedResponse>>(unreadKey)?.pages[0]
				?.rows
		).toHaveLength(1);
		client.clear();
	});
	it("reads a frozen group including its loaded children but leaves another group and later arrivals unread", () => {
		const client = new QueryClient();
		const first = item("first");
		const second = item("second");
		client.setQueryData(
			key,
			feed([
				{ ...row(first), groupKey: "group", unreadCount: 3, itemCount: 3 },
				row(second),
			])
		);
		const childKey = [
			...inboxQueryKeys.feeds(org),
			"user",
			{ groupKey: "group", snapshotId: "snapshot" },
		];
		client.setQueryData(childKey, feed([row(first), row(item("child"))]));
		const a = optimisticallyReadInbox(client, org, {
			snapshotId: "snapshot",
			groupKey: "group",
			operation: "read",
		});
		expect(current(client).rows.map((entry) => entry.unreadCount)).toEqual([
			0, 1,
		]);
		expect(
			client
				.getQueryData<InfiniteData<InboxFeedResponse>>(childKey)
				?.pages[0]?.rows.map((entry) => entry.unreadCount)
		).toEqual([0, 0]);
		client.setQueryData(
			key,
			feed([row(first), row(second), row(item("late"))], "new-snapshot")
		);
		expect(current(client).rows.map((entry) => entry.unreadCount)).toEqual([
			0, 1, 1,
		]);
		a.settle(false);
		expect(current(client).rows.map((entry) => entry.unreadCount)).toEqual([
			1, 1, 1,
		]);
		client.clear();
	});
	it("keeps an open request pending and yellow after reading it", () => {
		const client = new QueryClient();
		const request = {
			...item("approval"),
			attention: "action_required",
			resolutionStatus: "open",
		} as const;
		client.setQueryData(key, feed([row(request)]));
		const a = optimisticallyReadInbox(client, org, {
			item: request,
			read: true,
		});
		expect(current(client).rows[0]).toMatchObject({
			unreadCount: 0,
			dot: "yellow",
			item: { resolutionStatus: "open" },
		});
		a.settle(true);
		client.clear();
	});
});

function current(client: QueryClient) {
	const page =
		client.getQueryData<InfiniteData<InboxFeedResponse>>(key)?.pages[0];
	if (!page) {
		throw new Error("Expected a loaded Inbox page");
	}
	return page;
}
function feed(
	rows: InboxFeedRow[],
	snapshotId = "snapshot"
): InfiniteData<InboxFeedResponse> {
	const unread = rows.reduce((sum, entry) => sum + entry.unreadCount, 0);
	return {
		pageParams: [undefined],
		pages: [
			{
				organizationId: org,
				snapshotId,
				snapshotExpiresAt: "2099-01-01T00:00:00Z",
				nextCursor: null,
				selectionUnreadCount: unread,
				counts: {
					all: unread,
					unread,
					mentions: 0,
					needsAction: 0,
					needsReview: 0,
					priority: 0,
				},
				rows,
			},
		],
	};
}
function row(value: InboxItem): InboxFeedRow {
	return {
		item: value,
		groupKey: value.id,
		itemCount: 1,
		unreadCount: 1,
		latestOccurredAt: value.occurredAt,
		section: "activity",
		requestCategory: null,
		dot: "blue",
	};
}
function item(id: string): InboxItem {
	return {
		id,
		organizationId: org,
		recipientUserId: "user",
		attention: "update",
		importance: "normal",
		kind: "space_message",
		title: id,
		preview: "A message",
		contextLabel: "Room",
		sourceTarget: { kind: "space", spaceId: "space", signalId: id },
		resolutionStatus: "not_applicable",
		readAt: null,
		occurredAt: "2026-10-07T00:00:00Z",
		createdAt: "2026-10-07T00:00:00Z",
		updatedAt: "2026-10-07T00:00:00Z",
	};
}
