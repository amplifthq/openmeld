import type {
	GetSpaceUpdatesResponse,
	SignalEnvelope,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnreadHistoryPrefetch } from "#/components/spaces/use-unread-history-prefetch";
import type { SpaceHistorySnapshot } from "./history";
import {
	fetchSpaceUpdatesAfterSubscription,
	spaceHistoryPrefetchQueryOptions,
	spaceUpdatesQueryOptions,
} from "./history-sync";
import { spaceQueryKeys } from "./status";
import { createUnreadHistoryPrefetcher } from "./unread-history-prefetch";

const getUpdates = vi.hoisted(() => vi.fn());
vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => ({ getUpdates }),
}));
const clients: QueryClient[] = [];
const target = {
	spaceId: "space-123",
	openMeldProfileId: "profile-123",
	revision: 1,
};
const historyKey = spaceQueryKeys.history(
	target.spaceId,
	target.openMeldProfileId
);
function message(index: number): SignalEnvelope {
	return {
		v: 1,
		id: `sig-${index}`,
		spaceId: target.spaceId,
		ts: index,
		profile: {
			kind: "human",
			profileId: target.openMeldProfileId,
			profileName: "Mira",
		},
		type: "signal.text",
		data: { text: `Message ${index}` },
	} as SignalEnvelope;
}
function client() {
	const result = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(result);
	result.setQueryData(historyKey, {
		envelopes: [message(0)],
		nextCursor: "older-page",
	});
	return result;
}
function deferred() {
	let resolve!: (value: GetSpaceUpdatesResponse) => void;
	const promise = new Promise<GetSpaceUpdatesResponse>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
describe("unread conversation prefetch", () => {
	afterEach(() => {
		for (const item of clients.splice(0)) {
			item.clear();
		}
		vi.resetAllMocks();
		vi.restoreAllMocks();
	});
	it("uses sidebar unread changes without fetching active, cold, hidden or offline conversations", async () => {
		const queryClient = client();
		getUpdates.mockResolvedValue({ signals: [message(1)] });
		const visible = vi
			.spyOn(document, "visibilityState", "get")
			.mockReturnValue("hidden");
		const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
		const props = {
			accountId: "user-123",
			organizationId: "org-123",
			activeSpaceId: target.spaceId,
			conversations: [
				{ spaceId: target.spaceId, profileId: target.openMeldProfileId },
				{ spaceId: "cold-space", profileId: target.openMeldProfileId },
			],
			unread: new Map([
				[target.spaceId, { unreadCount: 1, latestUnreadOccurredAtMs: 1 }],
				["cold-space", { unreadCount: 1, latestUnreadOccurredAtMs: 2 }],
			]),
		};
		const hook = renderHook(useUnreadHistoryPrefetch, {
			initialProps: props,
			wrapper: ({ children }: PropsWithChildren) =>
				createElement(QueryClientProvider, { client: queryClient }, children),
		});
		expect(getUpdates).not.toHaveBeenCalled();
		visible.mockReturnValue("visible");
		document.dispatchEvent(new Event("visibilitychange"));
		expect(getUpdates).not.toHaveBeenCalled();
		online.mockReturnValue(false);
		hook.rerender({ ...props, activeSpaceId: "another-space" });
		expect(getUpdates).not.toHaveBeenCalled();
		online.mockReturnValue(true);
		window.dispatchEvent(new Event("online"));
		await vi.waitFor(() =>
			expect(
				queryClient.getQueryData<SpaceHistorySnapshot>(historyKey)?.envelopes
			).toEqual([message(0), message(1)])
		);
		expect(getUpdates).toHaveBeenCalledTimes(1);
		hook.unmount();
	});
	it("shares an in-flight page with navigation, merges a bounded contiguous page, and rechecks after subscribe", async () => {
		const queryClient = client();
		const pending = deferred();
		getUpdates.mockReturnValueOnce(pending.promise);
		const preload = queryClient.fetchQuery(
			spaceHistoryPrefetchQueryOptions(queryClient, target)
		);
		const page = queryClient.fetchQuery(
			spaceUpdatesQueryOptions({ ...target, afterSignalId: "sig-0" })
		);
		expect(getUpdates).toHaveBeenCalledTimes(1);
		pending.resolve({
			signals: Array.from({ length: 50 }, (_, i) => message(i + 1)),
		});
		await Promise.all([preload, page]);
		expect(queryClient.getQueryData<SpaceHistorySnapshot>(historyKey)).toEqual({
			envelopes: Array.from({ length: 51 }, (_, i) => message(i)),
			nextCursor: "older-page",
		});
		expect(getUpdates).toHaveBeenCalledTimes(1);
		getUpdates.mockResolvedValueOnce({ signals: [message(1)] });
		await queryClient.fetchQuery(
			spaceUpdatesQueryOptions({ ...target, afterSignalId: "sig-0" })
		);
		expect(getUpdates).toHaveBeenCalledTimes(2);
	});
	it("does not resurrect history removed during access cleanup", async () => {
		const queryClient = client();
		const pending = deferred();
		getUpdates.mockReturnValueOnce(pending.promise);
		const preload = queryClient.fetchQuery(
			spaceHistoryPrefetchQueryOptions(queryClient, target)
		);
		queryClient.removeQueries({ queryKey: historyKey, exact: true });
		pending.resolve({ signals: [message(1)] });
		await preload;
		expect(queryClient.getQueryData(historyKey)).toBeUndefined();
	});
	it("does not let a pre-subscription request satisfy the ready barrier", async () => {
		const queryClient = client();
		const pending = deferred();
		getUpdates
			.mockReturnValueOnce(pending.promise)
			.mockResolvedValueOnce({ signals: [message(1)] });
		const preload = queryClient.fetchQuery(
			spaceHistoryPrefetchQueryOptions(queryClient, target)
		);
		const ready = fetchSpaceUpdatesAfterSubscription(queryClient, {
			...target,
			afterSignalId: "sig-0",
		});
		expect(getUpdates).toHaveBeenCalledTimes(1);
		pending.resolve({ signals: [] });
		await preload;
		expect(await ready).toEqual({ signals: [message(1)] });
		expect(getUpdates).toHaveBeenCalledTimes(2);
	});
	it("keeps saved history and lets navigation retry after a failed speculative read", async () => {
		const queryClient = client();
		getUpdates.mockRejectedValueOnce(new Error("offline"));
		await queryClient.prefetchQuery(
			spaceHistoryPrefetchQueryOptions(queryClient, target)
		);
		expect(
			queryClient.getQueryData<SpaceHistorySnapshot>(historyKey)?.envelopes
		).toEqual([message(0)]);
		getUpdates.mockResolvedValueOnce({ signals: [message(1)] });
		await queryClient.fetchQuery(
			spaceHistoryPrefetchQueryOptions(queryClient, target)
		);
		expect(
			queryClient.getQueryData<SpaceHistorySnapshot>(historyKey)?.envelopes
		).toEqual([message(0), message(1)]);
	});
	it("limits background concurrency and batch size and does not repeat unchanged unread snapshots", async () => {
		const queryClient = client();
		const targets = Array.from({ length: 9 }, (_, i) => ({
			...target,
			spaceId: `space-${i}`,
		}));
		for (const item of targets) {
			queryClient.setQueryData(
				spaceQueryKeys.history(item.spaceId, item.openMeldProfileId),
				{ envelopes: [message(0)], nextCursor: null }
			);
		}
		const reads: ReturnType<typeof deferred>[] = [];
		getUpdates.mockImplementation(() => {
			const read = deferred();
			reads.push(read);
			return read.promise;
		});
		const owner = createUnreadHistoryPrefetcher(queryClient);
		owner.schedule(targets);
		expect(reads).toHaveLength(2);
		owner.schedule(targets);
		expect(reads).toHaveLength(2);
		reads[0].resolve({ signals: [] });
		await vi.waitFor(() => expect(reads).toHaveLength(3));
		reads[1].resolve({ signals: [] });
		await vi.waitFor(() => expect(reads).toHaveLength(4));
		reads[2].resolve({ signals: [] });
		await vi.waitFor(() => expect(reads).toHaveLength(5));
		reads[3].resolve({ signals: [] });
		reads[4].resolve({ signals: [] });
		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		owner.schedule(targets);
		expect(reads).toHaveLength(5);
		owner.dispose();
	});
	it("performs one trailing read for a newer unread revision and stops queued work on disposal", async () => {
		const queryClient = client();
		const first = deferred();
		getUpdates
			.mockReturnValueOnce(first.promise)
			.mockResolvedValue({ signals: [message(2)] });
		const owner = createUnreadHistoryPrefetcher(queryClient);
		owner.schedule([target]);
		owner.schedule([{ ...target, revision: 2 }]);
		expect(getUpdates).toHaveBeenCalledTimes(1);
		first.resolve({ signals: [message(1)] });
		await vi.waitFor(() => expect(getUpdates).toHaveBeenCalledTimes(2));
		await vi.waitFor(() =>
			expect(
				queryClient.getQueryData<SpaceHistorySnapshot>(historyKey)?.envelopes
			).toEqual([message(0), message(1), message(2)])
		);
		owner.dispose();
		owner.schedule([{ ...target, revision: 3 }]);
		expect(getUpdates).toHaveBeenCalledTimes(2);
	});
});
