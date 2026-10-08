import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
	centerAgentDirectMessageOpenQueryOptions,
	centerAgentDirectMessageSpaceProjectionQueryOptions,
} from "#/query/organizations/center-agent";
import { organizationInboxFeedQueryOptions } from "#/query/organizations/inbox-feed";
import {
	organizationDirectoryQueryOptions,
	organizationSpacesQueryOptions,
} from "#/query/organizations/organization-directory";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import {
	PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
	ROUTE_REVISIT_GC_TIME_MS,
} from "#/query/query-config";
import { spaceBootstrapQueryOptions } from "#/query/spaces/bootstrap";
import { spaceHistoryQueryOptions } from "#/query/spaces/history";
import { spaceMembersQueryOptions } from "#/query/spaces/members";
import { spaceStatusQueryOptions } from "#/query/spaces/status";

describe("frequently revisited route caches", () => {
	it("retains an Inbox view overnight but revalidates when its reader returns", async () => {
		vi.useFakeTimers();
		const client = new QueryClient();
		try {
			const policy = organizationInboxFeedQueryOptions({
				organizationId: "org-1",
				accountId: "user-1",
				category: "all",
				unreadOnly: false,
				agentsOnly: false,
			});
			const savedView = {
				organizationId: "org-1",
				snapshotId: "snapshot-1",
				snapshotExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
				rows: [],
				nextCursor: null,
				counts: {
					all: 0,
					mentions: 0,
					needsAction: 0,
					needsReview: 0,
					unread: 0,
					priority: 0,
				},
			};
			const read = vi.fn(async () => savedView);
			const options = {
				...policy,
				queryFn: read,
			};
			await client.fetchInfiniteQuery(options);
			await vi.advanceTimersByTimeAsync(8 * 60 * 60_000);
			expect(client.getQueryData(policy.queryKey)?.pages[0]).toEqual(savedView);
			const observer = new InfiniteQueryObserver(client, options);
			const unsubscribe = observer.subscribe(() => undefined);
			expect(observer.getCurrentResult().data?.pages[0]).toEqual(savedView);
			expect(read).toHaveBeenCalledTimes(2);
			unsubscribe();
		} finally {
			client.clear();
			vi.useRealTimers();
		}
	});
	it("keeps only persisted Profile and Space list display data for seven days", () => {
		expect(
			organizationDirectoryQueryOptions({
				enabled: true,
				organizationId: "org-acme",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			organizationSpacesQueryOptions({
				enabled: true,
				organizationId: "org-acme",
			}).gcTime
		).toBe(PERSISTED_DISPLAY_QUERY_GC_TIME_MS);
		expect(
			buildStartProfilesQueryOptions({
				enabled: true,
				storageScope: "user-1",
			}).gcTime
		).toBe(PERSISTED_DISPLAY_QUERY_GC_TIME_MS);
	});

	it("keeps recent ordinary and Center Agent conversation entry data in memory", () => {
		expect(
			spaceBootstrapQueryOptions({
				enabled: true,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			spaceStatusQueryOptions({
				enabled: true,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			spaceHistoryQueryOptions({
				enabled: true,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			}).gcTime
		).toBe(PERSISTED_DISPLAY_QUERY_GC_TIME_MS);
		expect(
			spaceMembersQueryOptions({
				enabled: true,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			centerAgentDirectMessageSpaceProjectionQueryOptions({
				enabled: true,
				organizationId: "org-acme",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			centerAgentDirectMessageOpenQueryOptions({
				organizationId: "org-acme",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
	});
});
