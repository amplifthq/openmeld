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
				data: { generatedAtMs: NOW_MS + 5001, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS,
				receivedAtMs: NOW_MS,
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

	it("clears a summary when it expires between render and the passive effect", () => {
		vi.useFakeTimers();
		vi.spyOn(Date, "now")
			.mockReturnValueOnce(NOW_MS + 44_999)
			.mockReturnValue(NOW_MS + 45_001);

		const { result } = renderHook(() =>
			useUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS, items: [...ITEMS] },
				isError: false,
				receivedAtMs: NOW_MS,
			})
		);

		expect(result.current).toEqual(ITEMS);
		act(() => vi.advanceTimersByTime(1));
		expect(result.current).toEqual([]);
	});
});
