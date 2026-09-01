import { ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS } from "@openmeld/schemas";
import type { AccountSpaceActiveWakeSummaryResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ACCOUNT_SPACE_ITEMS_POLL_INTERVAL_MS,
	accountSpaceItemsQueryOptions,
	selectUsableAccountSpaceActiveWakeSummaryItems,
	useUsableAccountSpaceActiveWakeSummaryItems,
} from "./account-spaces";

const listAccountSpaceItemsMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/spaces/account-spaces", () => ({
	listAccountSpaceItems: listAccountSpaceItemsMock,
}));

const CORE_NOW_MS = Date.parse("2026-08-09T00:00:00.000Z");
const ITEMS: AccountSpaceActiveWakeSummaryResponse["items"] = [
	{ activeWakeCount: 1, spaceId: "space-one" },
];

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("account Space Index refresh", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		listAccountSpaceItemsMock.mockReset().mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});
	});

	it("polls only in the foreground and revalidates immediately on focus", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const options = accountSpaceItemsQueryOptions({
			enabled: true,
			profileId: "human-1",
		});

		expect(options.refetchInterval).toBe(ACCOUNT_SPACE_ITEMS_POLL_INTERVAL_MS);
		expect(options.refetchIntervalInBackground).toBe(false);
		expect(options.refetchOnWindowFocus).toBe("always");

		const observer = new QueryObserver(queryClient, options);
		const unsubscribe = observer.subscribe(() => undefined);
		await vi.advanceTimersByTimeAsync(0);
		expect(listAccountSpaceItemsMock).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(ACCOUNT_SPACE_ITEMS_POLL_INTERVAL_MS - 1);
		expect(listAccountSpaceItemsMock).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(1);
		expect(listAccountSpaceItemsMock).toHaveBeenCalledTimes(2);

		unsubscribe();
		queryClient.clear();
	});
});

describe("account Space active Wake summary", () => {
	it("uses only a successful owner summary with a valid browser request anchor", () => {
		const requestStartedAtMs = 4000;
		const data = createPresentationSnapshot(requestStartedAtMs);

		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
				nowMonotonicMs: requestStartedAtMs,
			})
		).toEqual(ITEMS);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: createPresentationSnapshot(
					requestStartedAtMs,
					createSummary({ generatedAtMs: 0 })
				),
				isError: false,
				nowMonotonicMs: requestStartedAtMs,
			})
		).toEqual([]);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: true,
				nowMonotonicMs: requestStartedAtMs,
			})
		).toEqual([]);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: createPresentationSnapshot(null),
				isError: false,
				nowMonotonicMs: requestStartedAtMs,
			})
		).toEqual([]);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
				nowMonotonicMs: requestStartedAtMs - 1,
			})
		).toEqual([]);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
				nowMonotonicMs:
					requestStartedAtMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS,
			})
		).toEqual(ITEMS);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
				nowMonotonicMs:
					requestStartedAtMs + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS + 1,
			})
		).toEqual([]);
	});

	it.each([
		12_566,
		60 * 60 * 1000,
		-60 * 60 * 1000,
	])("does not compare the Core clock with the browser clock (%i ms offset)", (coreClockOffsetMs) => {
		const requestStartedAtMs = 7000;

		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: createPresentationSnapshot(
					requestStartedAtMs,
					createSummary({
						generatedAtMs: CORE_NOW_MS + coreClockOffsetMs,
					})
				),
				isError: false,
				nowMonotonicMs: requestStartedAtMs,
			})
		).toEqual(ITEMS);
	});

	it("keeps the production 12.566-second Core offset visible for one local budget", () => {
		vi.useFakeTimers();
		const requestStartedAtMs = performance.now();
		const data = createPresentationSnapshot(
			requestStartedAtMs,
			createSummary({ generatedAtMs: CORE_NOW_MS + 12_566 })
		);

		const { result } = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
			})
		);

		expect(result.current).toEqual(ITEMS);
		act(() =>
			vi.advanceTimersByTime(ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS + 1)
		);
		expect(result.current).toEqual([]);
	});

	it("fails closed for an SSR snapshot until the browser refetches it", () => {
		vi.useFakeTimers();
		const summary = createSummary();
		const serverSnapshot = createPresentationSnapshot(null, summary);
		const { rerender, result } = renderHook(
			({ data }) =>
				useUsableAccountSpaceActiveWakeSummaryItems({
					data,
					isError: false,
				}),
			{ initialProps: { data: serverSnapshot } }
		);

		expect(result.current).toEqual([]);
		const browserSnapshot = createPresentationSnapshot(
			performance.now(),
			summary
		);
		rerender({ data: browserSnapshot });
		expect(result.current).toEqual(ITEMS);
		act(() =>
			vi.advanceTimersByTime(ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS + 1)
		);
		expect(result.current).toEqual([]);
	});

	it("counts network time against the local presentation budget", () => {
		vi.useFakeTimers();
		const requestStartedAtMs = performance.now();
		act(() => vi.advanceTimersByTime(20_000));
		const data = createPresentationSnapshot(requestStartedAtMs);

		const { result } = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
			})
		);

		expect(result.current).toEqual(ITEMS);
		act(() =>
			vi.advanceTimersByTime(
				ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS - 20_000 + 1
			)
		);
		expect(result.current).toEqual([]);
	});

	it("rejects a response that arrives after its local presentation budget", () => {
		vi.useFakeTimers();
		const requestStartedAtMs = performance.now();
		act(() =>
			vi.advanceTimersByTime(ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS + 1)
		);
		const data = createPresentationSnapshot(requestStartedAtMs);

		const { result } = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
			})
		);

		expect(result.current).toEqual([]);
	});

	it("lets a new successful request renew an unchanged Core summary", () => {
		vi.useFakeTimers();
		const summary = createSummary();
		const firstSnapshot = createPresentationSnapshot(
			performance.now(),
			summary
		);
		const { rerender, result } = renderHook(
			({ data }) =>
				useUsableAccountSpaceActiveWakeSummaryItems({
					data,
					isError: false,
				}),
			{ initialProps: { data: firstSnapshot } }
		);

		act(() => vi.advanceTimersByTime(40_000));
		const secondSnapshot = createPresentationSnapshot(
			performance.now(),
			summary
		);
		rerender({ data: secondSnapshot });
		act(() => vi.advanceTimersByTime(5001));
		expect(result.current).toEqual(ITEMS);
		act(() => vi.advanceTimersByTime(39_999));
		expect(result.current).toEqual(ITEMS);
		act(() => vi.advanceTimersByTime(1));
		expect(result.current).toEqual([]);
	});

	it("does not renew a cached snapshot when it returns after another result", () => {
		vi.useFakeTimers();
		const firstSnapshot = createPresentationSnapshot(performance.now());
		const secondSnapshot = createPresentationSnapshot(
			performance.now() + 1000,
			createSummary({
				items: [{ activeWakeCount: 1, spaceId: "space-two" }],
			})
		);
		const { rerender, result } = renderHook(
			({ data }) =>
				useUsableAccountSpaceActiveWakeSummaryItems({
					data,
					isError: false,
				}),
			{ initialProps: { data: firstSnapshot } }
		);

		act(() => vi.advanceTimersByTime(1000));
		rerender({ data: secondSnapshot });
		rerender({ data: firstSnapshot });
		expect(result.current).toEqual(ITEMS);
		act(() =>
			vi.advanceTimersByTime(
				ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS - 1000 + 1
			)
		);
		expect(result.current).toEqual([]);
	});

	it("does not renew the same cached snapshot when the hook remounts", () => {
		vi.useFakeTimers();
		const data = createPresentationSnapshot(performance.now());
		const firstHook = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
			})
		);

		act(() => vi.advanceTimersByTime(1000));
		firstHook.unmount();
		const secondHook = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
			})
		);
		expect(secondHook.result.current).toEqual(ITEMS);
		act(() =>
			vi.advanceTimersByTime(
				ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS - 1000 + 1
			)
		);
		expect(secondHook.result.current).toEqual([]);
	});

	it("clears retained data immediately when the refresh errors", () => {
		vi.useFakeTimers();
		const data = createPresentationSnapshot(performance.now());
		const { rerender, result } = renderHook(
			({ isError }) =>
				useUsableAccountSpaceActiveWakeSummaryItems({ data, isError }),
			{ initialProps: { isError: false } }
		);

		expect(result.current).toEqual(ITEMS);
		rerender({ isError: true });
		expect(result.current).toEqual([]);
	});
});

function createSummary(
	input: Partial<AccountSpaceActiveWakeSummaryResponse> = {}
): AccountSpaceActiveWakeSummaryResponse {
	return {
		generatedAtMs: input.generatedAtMs ?? CORE_NOW_MS,
		items: input.items ?? ITEMS,
	};
}

function createPresentationSnapshot(
	browserRequestStartedAtMonotonicMs: number | null,
	summary = createSummary()
) {
	return { browserRequestStartedAtMonotonicMs, summary };
}
