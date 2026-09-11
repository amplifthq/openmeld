import { describe, expect, it } from "vitest";
import { resolveSpaceReadingHeaderProgress } from "./space-reading-header";

describe("Space reading header position", () => {
	it.each([
		[25, 0],
		[60, 0],
		[96, 1],
		[143, 1],
		[500, 1],
	])("settles a restored or finished scroll %ipx from the bottom at endpoint %i", (distance, endpoint) => {
		expect(resolveSpaceReadingHeaderProgress(distance, false)).toBe(endpoint);
	});
	it("keeps a real scroll gesture continuous but returns to the expanded row at the latest messages", () => {
		expect(resolveSpaceReadingHeaderProgress(96, true)).toBeCloseTo(0.6);
		for (const isUserScrolling of [true, false]) {
			expect(resolveSpaceReadingHeaderProgress(0, isUserScrolling)).toBe(0);
			expect(resolveSpaceReadingHeaderProgress(24, isUserScrolling)).toBe(0);
		}
	});
	it("continues from restored endpoints without reversing before following the scroll gesture", () => {
		const restoredCompact = { distance: 96, progress: 1 };
		expect(resolveSpaceReadingHeaderProgress(100, true, restoredCompact)).toBe(
			1
		);
		expect(
			resolveSpaceReadingHeaderProgress(60, true, restoredCompact)
		).toBeCloseTo(0.5);
		const settledExpanded = { distance: 60, progress: 0 };
		expect(resolveSpaceReadingHeaderProgress(50, true, settledExpanded)).toBe(
			0
		);
		expect(
			resolveSpaceReadingHeaderProgress(102, true, settledExpanded)
		).toBeCloseTo(0.5);
		expect(resolveSpaceReadingHeaderProgress(144, true, settledExpanded)).toBe(
			1
		);
	});
});
