import { describe, expect, it } from "vitest";
import { selectUsableAccountSpaceActiveWakeSummaryItems } from "./account-spaces";

const NOW_MS = Date.parse("2026-08-09T00:00:00.000Z");
const ITEMS = [{ activeWakeCount: 1, spaceId: "space-one" }] as const;

describe("account Space active Wake summary", () => {
	it("uses only a current successful owner snapshot", () => {
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS,
			})
		).toEqual(ITEMS);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: 0, items: [...ITEMS] },
				isError: false,
				nowMs: NOW_MS,
			})
		).toEqual([]);
		expect(
			selectUsableAccountSpaceActiveWakeSummaryItems({
				data: { generatedAtMs: NOW_MS, items: [...ITEMS] },
				isError: true,
				nowMs: NOW_MS,
			})
		).toEqual([]);
	});
});
