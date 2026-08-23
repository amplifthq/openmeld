import type { AccountSpaceActiveWakeSummaryResponse } from "@openmeld/schemas/types";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	selectUsableAccountSpaceActiveWakeSummaryItems,
	useUsableAccountSpaceActiveWakeSummaryItems,
} from "./account-spaces";

const NOW_MS = Date.parse("2026-08-09T00:00:00.000Z");
const ITEMS = [{ activeWakeCount: 1, spaceId: "space-one" }] as const;

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("account Space active Wake summary", () => {
	it("uses only a current successful owner snapshot", () => {
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS,
				receivedAtMs: NOW_MS,
			})
		).toEqual(ITEMS);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: 0, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS,
				receivedAtMs: NOW_MS,
			})
		).toEqual([]);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS, items: [...ITEMS] },
				isError: true,
				nowMs: NOW_MS,
				receivedAtMs: NOW_MS,
			})
		).toEqual([]);
	});

	it("accepts ordinary Core and browser clock skew without trusting a distant future timestamp", () => {
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS + 1100, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS,
				receivedAtMs: NOW_MS,
			})
		).toEqual(ITEMS);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS + 1100, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS,
				receivedAtMs: NOW_MS + 1100,
			})
		).toEqual(ITEMS);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS + 5001, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS,
				receivedAtMs: NOW_MS,
			})
		).toEqual([]);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS + 5001, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS,
				receivedAtMs: NOW_MS + 1100,
			})
		).toEqual([]);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS,
				receivedAtMs: NOW_MS + 5001,
			})
		).toEqual([]);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS + 1100, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS + 45_001,
				receivedAtMs: NOW_MS,
			})
		).toEqual([]);
	});

	it("keeps an SSR-hydrated summary with ordinary receipt clock skew", () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW_MS);
		const data = {
			generatedAtMs: NOW_MS + 1100,
			items: [...ITEMS],
		};

		const { result } = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
				receivedAtMs: NOW_MS + 1100,
			})
		);

		expect(result.current).toEqual(ITEMS);
		act(() => vi.advanceTimersByTime(45_001));
		expect(result.current).toEqual([]);
	});

	it("rechecks a changed receipt without extending the same owner snapshot", () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW_MS);
		const data = {
			generatedAtMs: NOW_MS + 1100,
			items: [...ITEMS],
		};
		const { rerender, result } = renderHook(
			({ receivedAtMs }) =>
				useUsableAccountSpaceActiveWakeSummaryItems({
					data,
					isError: false,
					receivedAtMs,
				}),
			{ initialProps: { receivedAtMs: NOW_MS + 5001 } }
		);

		expect(result.current).toEqual([]);
		rerender({ receivedAtMs: NOW_MS + 1100 });
		expect(result.current).toEqual(ITEMS);
		act(() => vi.advanceTimersByTime(45_001));
		expect(result.current).toEqual([]);
		rerender({ receivedAtMs: NOW_MS + 2000 });
		expect(result.current).toEqual([]);
	});

	it("does not let an old snapshot timer expire its replacement", () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW_MS);
		const firstData: AccountSpaceActiveWakeSummaryResponse = {
			generatedAtMs: NOW_MS,
			items: [...ITEMS],
		};
		const secondItems = [{ activeWakeCount: 2, spaceId: "space-two" }] as const;
		const secondData: AccountSpaceActiveWakeSummaryResponse = {
			generatedAtMs: NOW_MS + 40_000,
			items: [...secondItems],
		};
		const { rerender, result } = renderHook(
			({ data, receivedAtMs }) =>
				useUsableAccountSpaceActiveWakeSummaryItems({
					data,
					isError: false,
					receivedAtMs,
				}),
			{
				initialProps: { data: firstData, receivedAtMs: NOW_MS },
			}
		);

		act(() => vi.advanceTimersByTime(40_000));
		rerender({ data: secondData, receivedAtMs: NOW_MS + 40_000 });
		expect(result.current).toEqual(secondItems);
		act(() => vi.advanceTimersByTime(5001));
		expect(result.current).toEqual(secondItems);
		act(() => vi.advanceTimersByTime(40_000));
		expect(result.current).toEqual([]);
	});

	it("keeps the earliest browser anchor when a cached snapshot returns", () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW_MS);
		const firstData: AccountSpaceActiveWakeSummaryResponse = {
			generatedAtMs: NOW_MS + 1100,
			items: [...ITEMS],
		};
		const secondData: AccountSpaceActiveWakeSummaryResponse = {
			generatedAtMs: NOW_MS + 1000,
			items: [{ activeWakeCount: 1, spaceId: "space-two" }],
		};
		const { rerender, result } = renderHook(
			({ data, receivedAtMs }) =>
				useUsableAccountSpaceActiveWakeSummaryItems({
					data,
					isError: false,
					receivedAtMs,
				}),
			{
				initialProps: {
					data: firstData,
					receivedAtMs: NOW_MS + 1100,
				},
			}
		);

		act(() => vi.advanceTimersByTime(1000));
		rerender({ data: secondData, receivedAtMs: NOW_MS + 1000 });
		rerender({ data: firstData, receivedAtMs: NOW_MS + 1100 });
		expect(result.current).toEqual(ITEMS);
		act(() => vi.advanceTimersByTime(44_001));
		expect(result.current).toEqual([]);
	});

	it("keeps the earliest browser anchor when the hook remounts", () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW_MS);
		const data = {
			generatedAtMs: NOW_MS + 1100,
			items: [...ITEMS],
		};
		const firstHook = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
				receivedAtMs: NOW_MS + 1100,
			})
		);

		act(() => vi.advanceTimersByTime(1000));
		firstHook.unmount();
		const secondHook = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
				receivedAtMs: NOW_MS + 1100,
			})
		);
		expect(secondHook.result.current).toEqual(ITEMS);
		act(() => vi.advanceTimersByTime(44_001));
		expect(secondHook.result.current).toEqual([]);
	});

	it("does not let an abandoned render change a committed snapshot", () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW_MS);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const data: AccountSpaceActiveWakeSummaryResponse = {
			generatedAtMs: NOW_MS + 4000,
			items: [...ITEMS],
		};

		expect(() =>
			renderHook(() => {
				useUsableAccountSpaceActiveWakeSummaryItems({
					data,
					isError: false,
					receivedAtMs: NOW_MS - 1000,
				});
				throw new Error("abandoned observation");
			})
		).toThrowError("abandoned observation");

		const committedHook = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
				receivedAtMs: NOW_MS + 4000,
			})
		);
		expect(committedHook.result.current).toEqual(ITEMS);
		act(() => vi.advanceTimersByTime(44_001));
		expect(committedHook.result.current).toEqual(ITEMS);
		act(() => vi.advanceTimersByTime(1000));
		expect(committedHook.result.current).toEqual([]);
	});

	it("clears a summary when it expires between render and the passive effect", () => {
		vi.useFakeTimers();
		vi.spyOn(Date, "now")
			.mockReturnValueOnce(NOW_MS + 44_999)
			.mockReturnValueOnce(NOW_MS + 44_999)
			.mockReturnValue(NOW_MS + 45_001);
		const data = { generatedAtMs: NOW_MS, items: [...ITEMS] };

		const { result } = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data,
				isError: false,
				receivedAtMs: NOW_MS,
			})
		);

		expect(result.current).toEqual(ITEMS);
		act(() => vi.advanceTimersByTime(1));
		expect(result.current).toEqual([]);
	});
});
